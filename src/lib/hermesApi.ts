import type {
  HermesAuthUser,
  HermesChatMessage,
  HermesCronJob,
  HermesCronRun,
  HermesFallbackProvider,
  HermesMcpCatalogEntry,
  HermesMcpServer,
  HermesMessagingPlatform,
  HermesModelOptionsResponse,
  HermesProfile,
  HermesSessionSearchHit,
  HermesSessionSummary,
  HermesStatusResponse,
} from "../../shared/types";

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers || {}),
    },
    ...init,
  });

  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }

  if (!res.ok) {
    const errObj = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
    const detail =
      (typeof errObj.detail === "string" && errObj.detail) ||
      (typeof errObj.message === "string" && errObj.message) ||
      (typeof errObj.error === "string" && errObj.error) ||
      `HTTP ${res.status}`;
    const code = typeof errObj.error === "string" ? errObj.error : undefined;
    throw new ApiError(detail, res.status, code);
  }

  return parsed as T;
}

export interface PocketPageSummary {
  id: string;
  title: string;
  summary: string;
  bot: string;
  createdAt: number;
}

export async function fetchPocketPages(): Promise<PocketPageSummary[]> {
  const data = await requestJson<{ pages?: PocketPageSummary[] }>("/api/pocket/pages");
  return Array.isArray(data?.pages) ? data.pages : [];
}

export async function fetchStatus(): Promise<HermesStatusResponse> {
  return requestJson<HermesStatusResponse>("/api/status");
}

export async function fetchCurrentUser(): Promise<HermesAuthUser | null> {
  try {
    return await requestJson<HermesAuthUser>("/api/auth/me");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      return null;
    }
    throw err;
  }
}

export async function passwordLogin(
  username: string,
  password: string,
  provider = "basic"
): Promise<{ ok: boolean }> {
  return requestJson<{ ok: boolean }>("/auth/password-login", {
    method: "POST",
    body: JSON.stringify({ provider, username, password, next: "" }),
  });
}

export async function logout(): Promise<void> {
  await requestJson<{ ok: boolean }>("/auth/logout", { method: "POST" });
}

export async function fetchProfiles(): Promise<HermesProfile[]> {
  const data = await requestJson<{ profiles?: HermesProfile[] } | HermesProfile[]>("/api/profiles");
  if (Array.isArray(data)) return data;
  return Array.isArray(data?.profiles) ? data.profiles : [];
}

export async function createProfile(payload: {
  name: string;
  description?: string;
  soul?: string;
  model?: string;
  provider?: string;
  mirror_credentials?: boolean;
  share_auth?: boolean;
}): Promise<{ ok: boolean; name: string }> {
  return requestJson<{ ok: boolean; name: string }>("/api/profiles", {
    method: "POST",
    body: JSON.stringify({
      mirror_credentials: true,
      share_auth: true,
      ...payload,
    }),
  });
}

export async function deleteProfile(name: string): Promise<void> {
  await requestJson(`/api/profiles/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
}

export async function fetchProfileSoul(name: string): Promise<string> {
  const data = await requestJson<{ soul?: string; content?: string }>(
    `/api/profiles/${encodeURIComponent(name)}/soul`
  );
  return data?.soul ?? data?.content ?? "";
}

export async function updateProfileSoul(name: string, soul: string): Promise<void> {
  await requestJson(`/api/profiles/${encodeURIComponent(name)}/soul`, {
    method: "PUT",
    body: JSON.stringify({ content: soul, soul }),
  });
}

export async function updateProfileDescription(name: string, description: string): Promise<void> {
  await requestJson(`/api/profiles/${encodeURIComponent(name)}/description`, {
    method: "PUT",
    body: JSON.stringify({ description }),
  });
}

export async function fetchModelOptions(
  profile?: string,
  refresh = false
): Promise<HermesModelOptionsResponse> {
  const params = new URLSearchParams();
  if (profile) params.set("profile", profile);
  if (refresh) params.set("refresh", "true");
  const query = params.toString() ? `?${params.toString()}` : "";
  return requestJson<HermesModelOptionsResponse>(`/api/model/options${query}`);
}

export async function updateProfileModel(
  profileName: string,
  provider: string,
  model: string
): Promise<{ ok: boolean; provider: string; model: string }> {
  return requestJson<{ ok: boolean; provider: string; model: string }>(
    `/api/profiles/${encodeURIComponent(profileName)}/model`,
    {
      method: "PUT",
      body: JSON.stringify({ provider, model }),
    }
  );
}

export async function fetchProfileFallback(
  profileName?: string
): Promise<HermesFallbackProvider[]> {
  const params = new URLSearchParams();
  if (profileName) params.set("profile", profileName);
  const query = params.toString() ? `?${params.toString()}` : "";
  const data = await requestJson<{
    ok: boolean;
    fallback_providers?: HermesFallbackProvider[];
  }>(`/api/pocket/fallback${query}`);
  return Array.isArray(data?.fallback_providers) ? data.fallback_providers : [];
}

export async function updateProfileFallback(
  profileName: string,
  fallbackProviders: HermesFallbackProvider[]
): Promise<HermesFallbackProvider[]> {
  const params = new URLSearchParams({ profile: profileName });
  const data = await requestJson<{
    ok: boolean;
    fallback_providers?: HermesFallbackProvider[];
  }>(`/api/pocket/fallback?${params.toString()}`, {
    method: "PUT",
    body: JSON.stringify({ fallback_providers: fallbackProviders }),
  });
  return Array.isArray(data?.fallback_providers) ? data.fallback_providers : [];
}

export async function saveProfileSecret(
  profileName: string,
  key: string,
  value: string
): Promise<{
  ok: boolean;
  key: string;
  envPathHint?: string;
  passthroughRegistered?: boolean;
}> {
  const params = new URLSearchParams({ profile: profileName });
  return requestJson<{
    ok: boolean;
    key: string;
    envPathHint?: string;
    passthroughRegistered?: boolean;
  }>(`/api/pocket/secret?${params.toString()}`, {
    method: "PUT",
    body: JSON.stringify({ profile: profileName, key, value }),
  });
}

export async function updateProfilePrivacy(
  profileName: string,
  isPrivate: boolean
): Promise<{ ok: boolean; profile: string; private: boolean }> {
  const params = new URLSearchParams({ profile: profileName });
  return requestJson<{ ok: boolean; profile: string; private: boolean }>(
    `/api/pocket/privacy?${params.toString()}`,
    {
      method: "PUT",
      body: JSON.stringify({ profile: profileName, private: isPrivate }),
    }
  );
}

export async function searchSessions(
  query: string,
  profile?: string,
  limit = 8
): Promise<HermesSessionSearchHit[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const params = new URLSearchParams({ q: trimmed, limit: String(limit) });
  if (profile) params.set("profile", profile);
  const data = await requestJson<{ results?: HermesSessionSearchHit[] }>(
    `/api/sessions/search?${params.toString()}`
  );
  const rows = Array.isArray(data?.results) ? data.results : [];
  return rows
    .map((r) => ({
      ...r,
      id: r.id || r.session_id || "",
      session_id: r.session_id || r.id || "",
      profile: r.profile || profile || "default",
    }))
    .filter((r) => Boolean(r.session_id));
}

export async function fetchSessions(profile?: string, limit = 40): Promise<HermesSessionSummary[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (profile) params.set("profile", profile);
  const data = await requestJson<
    { sessions?: HermesSessionSummary[]; items?: HermesSessionSummary[] } | HermesSessionSummary[]
  >(`/api/sessions?${params.toString()}`);

  const rawList = Array.isArray(data)
    ? data
    : Array.isArray(data?.sessions)
      ? data.sessions
      : Array.isArray(data?.items)
        ? data.items
        : [];

  return rawList.map((s) => ({
    ...s,
    id: s.id || s.session_id || "",
  })).filter((s) => Boolean(s.id));
}

function extractMessageContent(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) {
    return raw
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object") {
          const obj = part as Record<string, unknown>;
          if (typeof obj.text === "string") return obj.text;
          if (typeof obj.content === "string") return obj.content;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (typeof obj.text === "string") return obj.text;
    if (typeof obj.content === "string") return obj.content;
  }
  return "";
}

export function normalizeMessages(rawList: unknown[]): HermesChatMessage[] {
  const result: HermesChatMessage[] = [];
  for (let i = 0; i < rawList.length; i++) {
    const item = rawList[i];
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const roleRaw = String(obj.role || "assistant").toLowerCase();
    if (obj.display_kind === "hidden") continue;
    const role: HermesChatMessage["role"] =
      roleRaw === "user" || roleRaw === "assistant" || roleRaw === "system" || roleRaw === "tool"
        ? roleRaw
        : "assistant";
    const content = extractMessageContent(obj.content ?? obj.text ?? "");
    const reasoning = typeof obj.reasoning === "string" ? obj.reasoning : null;
    if (!content.trim() && !reasoning && (role === "tool" || role === "assistant")) continue;
    result.push({
      id: (obj.id as string | number | undefined) ?? (obj.row_id as number | undefined) ?? `m-${i}`,
      row_id: typeof obj.row_id === "number" ? obj.row_id : undefined,
      role,
      content,
      reasoning,
      tool_name: typeof obj.tool_name === "string" ? obj.tool_name : typeof obj.name === "string" ? obj.name : null,
      timestamp: (obj.timestamp ?? obj.created_at ?? null) as string | number | null,
      display_kind: typeof obj.display_kind === "string" ? obj.display_kind : null,
    });
  }
  return result;
}

export async function fetchSessionMessages(
  sessionId: string,
  profile?: string
): Promise<HermesChatMessage[]> {
  const params = new URLSearchParams();
  if (profile) params.set("profile", profile);
  const query = params.toString() ? `?${params.toString()}` : "";
  const data = await requestJson<{ messages?: unknown[] } | unknown[]>(
    `/api/sessions/${encodeURIComponent(sessionId)}/messages${query}`
  );
  const list = Array.isArray(data) ? data : Array.isArray(data?.messages) ? data.messages : [];
  return normalizeMessages(list);
}

export async function renameSession(
  sessionId: string,
  title: string,
  profile?: string
): Promise<void> {
  const params = new URLSearchParams();
  if (profile) params.set("profile", profile);
  const query = params.toString() ? `?${params.toString()}` : "";
  await requestJson(`/api/sessions/${encodeURIComponent(sessionId)}${query}`, {
    method: "PATCH",
    body: JSON.stringify({ title, ...(profile ? { profile } : {}) }),
  });
}

export async function deleteSession(sessionId: string, profile?: string): Promise<void> {
  const params = new URLSearchParams();
  if (profile) params.set("profile", profile);
  const query = params.toString() ? `?${params.toString()}` : "";
  await requestJson(`/api/sessions/${encodeURIComponent(sessionId)}${query}`, {
    method: "DELETE",
  });
}

export async function uploadChatFile(
  file: File,
  profile?: string
): Promise<{
  ok: boolean;
  path: string;
  size: number;
  staged_upload?: Record<string, unknown>;
}> {
  const params = new URLSearchParams();
  if (profile) params.set("profile", profile);
  const query = params.toString() ? `?${params.toString()}` : "";

  const form = new FormData();
  form.append("file", file, file.name);

  const res = await fetch(`/api/chat/file-upload${query}`, {
    method: "POST",
    credentials: "same-origin",
    body: form,
  });

  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }
  if (!res.ok) {
    const errObj = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
    const detail =
      (typeof errObj.detail === "string" && errObj.detail) ||
      (typeof errObj.message === "string" && errObj.message) ||
      `Upload fehlgeschlagen (HTTP ${res.status})`;
    throw new ApiError(detail, res.status);
  }
  return parsed as {
    ok: boolean;
    path: string;
    size: number;
    staged_upload?: Record<string, unknown>;
  };
}

/**
 * Scales large camera/iPhone images cleanly to max 1600px JPEG data URL so they
 * transfer fast over Tailscale and work reliably with Hermes image.attach_bytes.
 */
export async function prepareChatImageDataUrl(file: File, maxDim = 1600): Promise<string> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error(`Bild „${file.name}“ konnte nicht gelesen werden.`));
      el.src = objectUrl;
    });

    const srcW = img.naturalWidth || img.width;
    const srcH = img.naturalHeight || img.height;
    const scale = Math.min(1, maxDim / Math.max(srcW, srcH, 1));
    const width = Math.max(1, Math.round(srcW * scale));
    const height = Math.max(1, Math.round(srcH * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas nicht verfügbar.");
    ctx.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", 0.86);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

// ── Routines (Cron) ───────────────────────────────────────────────────────────

export async function fetchCronJobs(profile = "all"): Promise<HermesCronJob[]> {
  const params = new URLSearchParams({ profile });
  const data = await requestJson<{ jobs?: HermesCronJob[] } | HermesCronJob[]>(
    `/api/cron/jobs?${params.toString()}`
  );
  if (Array.isArray(data)) return data;
  return Array.isArray(data?.jobs) ? data.jobs : [];
}

export async function fetchCronJobRuns(
  jobId: string,
  profile?: string,
  limit = 15
): Promise<HermesCronRun[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (profile) params.set("profile", profile);
  const data = await requestJson<{ runs?: HermesCronRun[] } | HermesCronRun[]>(
    `/api/cron/jobs/${encodeURIComponent(jobId)}/runs?${params.toString()}`
  );
  if (Array.isArray(data)) return data;
  return Array.isArray(data?.runs) ? data.runs : [];
}

export async function pauseCronJob(jobId: string, profile?: string): Promise<void> {
  const params = new URLSearchParams();
  if (profile) params.set("profile", profile);
  const query = params.toString() ? `?${params.toString()}` : "";
  await requestJson(`/api/cron/jobs/${encodeURIComponent(jobId)}/pause${query}`, {
    method: "POST",
  });
}

export async function resumeCronJob(jobId: string, profile?: string): Promise<void> {
  const params = new URLSearchParams();
  if (profile) params.set("profile", profile);
  const query = params.toString() ? `?${params.toString()}` : "";
  await requestJson(`/api/cron/jobs/${encodeURIComponent(jobId)}/resume${query}`, {
    method: "POST",
  });
}

export async function triggerCronJob(jobId: string, profile?: string): Promise<void> {
  const params = new URLSearchParams();
  if (profile) params.set("profile", profile);
  const query = params.toString() ? `?${params.toString()}` : "";
  await requestJson(`/api/cron/jobs/${encodeURIComponent(jobId)}/trigger${query}`, {
    method: "POST",
  });
}

// ── Email / Messaging Platforms ───────────────────────────────────────────────

export async function fetchMessagingPlatforms(
  profile?: string
): Promise<HermesMessagingPlatform[]> {
  const params = new URLSearchParams();
  if (profile) params.set("profile", profile);
  const query = params.toString() ? `?${params.toString()}` : "";
  const data = await requestJson<
    { platforms?: HermesMessagingPlatform[] } | HermesMessagingPlatform[]
  >(`/api/messaging/platforms${query}`);
  if (Array.isArray(data)) return data;
  return Array.isArray(data?.platforms) ? data.platforms : [];
}

export async function updateMessagingPlatform(
  platformId: string,
  payload: { enabled?: boolean; env?: Record<string, string | null> },
  profile?: string
): Promise<unknown> {
  const params = new URLSearchParams();
  if (profile) params.set("profile", profile);
  const query = params.toString() ? `?${params.toString()}` : "";
  return requestJson(
    `/api/messaging/platforms/${encodeURIComponent(platformId)}${query}`,
    {
      method: "PUT",
      body: JSON.stringify(payload),
    }
  );
}

export async function testMessagingPlatform(
  platformId: string,
  profile?: string
): Promise<{ ok?: boolean; message?: string; detail?: string; error?: string }> {
  const params = new URLSearchParams();
  if (profile) params.set("profile", profile);
  const query = params.toString() ? `?${params.toString()}` : "";
  return requestJson(
    `/api/messaging/platforms/${encodeURIComponent(platformId)}/test${query}`,
    {
      method: "POST",
    }
  );
}

// ── MCP Servers & Catalog (Hermes Connectors) ─────────────────────────────────

export async function fetchMcpServers(profile?: string): Promise<HermesMcpServer[]> {
  const params = new URLSearchParams();
  if (profile) params.set("profile", profile);
  const query = params.toString() ? `?${params.toString()}` : "";
  const data = await requestJson<{ servers?: HermesMcpServer[] } | HermesMcpServer[]>(
    `/api/mcp/servers${query}`
  );
  if (Array.isArray(data)) return data;
  return Array.isArray(data?.servers) ? data.servers : [];
}

export async function fetchMcpCatalog(profile?: string): Promise<HermesMcpCatalogEntry[]> {
  const params = new URLSearchParams();
  if (profile) params.set("profile", profile);
  const query = params.toString() ? `?${params.toString()}` : "";
  const data = await requestJson<{ entries?: HermesMcpCatalogEntry[] }>(
    `/api/mcp/catalog${query}`
  );
  return Array.isArray(data?.entries) ? data.entries : [];
}

export async function toggleMcpServer(
  name: string,
  enabled: boolean,
  profile?: string
): Promise<unknown> {
  const params = new URLSearchParams();
  if (profile) params.set("profile", profile);
  const query = params.toString() ? `?${params.toString()}` : "";
  return requestJson(
    `/api/mcp/servers/${encodeURIComponent(name)}/enabled${query}`,
    {
      method: "PUT",
      body: JSON.stringify({ enabled }),
    }
  );
}

export async function testMcpServer(
  name: string,
  profile?: string
): Promise<{ ok?: boolean; status?: string; tool_count?: number; error?: string; detail?: string }> {
  const params = new URLSearchParams();
  if (profile) params.set("profile", profile);
  const query = params.toString() ? `?${params.toString()}` : "";
  return requestJson(
    `/api/mcp/servers/${encodeURIComponent(name)}/test${query}`,
    {
      method: "POST",
    }
  );
}

export interface McpOAuthFlowSnapshot {
  flow_id?: string;
  server_name?: string;
  status?: string;
  authorization_url?: string;
  auth_url?: string;
  authorize_url?: string;
  url?: string;
  redirect_uri?: string;
  error?: string;
  message?: string;
  tools?: unknown[];
}

export async function startMcpServerAuth(
  name: string,
  profile?: string
): Promise<McpOAuthFlowSnapshot> {
  const params = new URLSearchParams();
  if (profile) params.set("profile", profile);
  const query = params.toString() ? `?${params.toString()}` : "";
  return requestJson(
    `/api/mcp/servers/${encodeURIComponent(name)}/auth${query}`,
    {
      method: "POST",
    }
  );
}

export async function pollMcpOAuthFlow(flowId: string): Promise<McpOAuthFlowSnapshot> {
  return requestJson(`/api/mcp/oauth/flows/${encodeURIComponent(flowId)}`);
}

export async function cancelMcpOAuthFlow(flowId: string): Promise<void> {
  await requestJson(`/api/mcp/oauth/flows/${encodeURIComponent(flowId)}`, {
    method: "DELETE",
  });
}

export async function installMcpCatalogEntry(
  name: string,
  profile?: string
): Promise<unknown> {
  const params = new URLSearchParams();
  if (profile) params.set("profile", profile);
  const query = params.toString() ? `?${params.toString()}` : "";
  return requestJson(`/api/mcp/catalog/install${query}`, {
    method: "POST",
    body: JSON.stringify({ name, enable: true }),
  });
}

export interface QuickPromptItem {
  label: string;
  prompt: string;
}

export interface ServerUiPreferences {
  hiddenProfiles: string[];
  vaultPinHash: string | null;
  quickPrompts: Record<string, QuickPromptItem[]>;
  updatedAt: number;
}

export async function fetchServerUiPreferences(): Promise<ServerUiPreferences> {
  const data = await requestJson<Partial<ServerUiPreferences>>("/api/pocket/preferences");
  return {
    hiddenProfiles: Array.isArray(data.hiddenProfiles) ? data.hiddenProfiles : [],
    vaultPinHash: typeof data.vaultPinHash === "string" ? data.vaultPinHash : null,
    quickPrompts:
      data.quickPrompts && typeof data.quickPrompts === "object" ? data.quickPrompts : {},
    updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : 0,
  };
}

export async function updateServerUiPreferences(
  patch: Partial<Pick<ServerUiPreferences, "hiddenProfiles" | "vaultPinHash" | "quickPrompts">>
): Promise<ServerUiPreferences> {
  const data = await requestJson<Partial<ServerUiPreferences>>("/api/pocket/preferences", {
    method: "PUT",
    body: JSON.stringify(patch),
  });
  return {
    hiddenProfiles: Array.isArray(data.hiddenProfiles) ? data.hiddenProfiles : [],
    vaultPinHash: typeof data.vaultPinHash === "string" ? data.vaultPinHash : null,
    quickPrompts:
      data.quickPrompts && typeof data.quickPrompts === "object" ? data.quickPrompts : {},
    updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : 0,
  };
}

export interface ChecklistItemDto {
  text: string;
  checked: boolean;
}

export interface StoredChecklistDto {
  id: string;
  title: string;
  items: ChecklistItemDto[];
  updatedAt: number;
}

export async function fetchChecklist(id: string): Promise<StoredChecklistDto | null> {
  try {
    const data = await requestJson<{ checklist?: StoredChecklistDto }>(
      `/api/pocket/checklists/${encodeURIComponent(id)}`
    );
    return data.checklist || null;
  } catch {
    return null;
  }
}

export async function saveChecklist(
  id: string,
  title: string,
  items: ChecklistItemDto[]
): Promise<StoredChecklistDto> {
  const data = await requestJson<{ checklist: StoredChecklistDto }>(
    `/api/pocket/checklists/${encodeURIComponent(id)}`,
    {
      method: "PUT",
      body: JSON.stringify({ title, items }),
    }
  );
  return data.checklist;
}

export async function fetchShortcutConfig(): Promise<{ token: string; endpoint: string }> {
  const data = await requestJson<{ token: string; endpoint: string }>("/api/pocket/shortcut/config");
  return { token: data.token, endpoint: data.endpoint };
}

export async function rotateShortcutTokenApi(): Promise<{ token: string }> {
  const data = await requestJson<{ token: string }>("/api/pocket/shortcut/rotate", {
    method: "POST",
  });
  return { token: data.token };
}

export interface AppUpdateStatus {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  releaseUrl: string;
  releaseNotes: string;
  updateCommand: string;
}

export async function fetchAppUpdateStatus(force = false): Promise<AppUpdateStatus> {
  return requestJson<AppUpdateStatus>(`/api/pocket/update-check${force ? "?force=1" : ""}`);
}

export interface BrowserDesktopInfo {
  available: boolean;
  id?: string;
  /** App-relative path of the proxied live desktop, e.g. `/desk/9223/`. */
  path?: string;
  label?: string;
}

/** Live browser desktop this bot is attached to (null when it has none). */
export async function fetchBrowserDesktop(profile: string): Promise<BrowserDesktopInfo> {
  return requestJson<BrowserDesktopInfo>(
    `/api/pocket/browser-desktop?profile=${encodeURIComponent(profile)}`
  );
}

/** Types text into the focused field of the page shown in the bot's live browser. */
export async function insertBrowserText(id: string, text: string): Promise<{ ok: boolean }> {
  return requestJson<{ ok: boolean }>("/api/pocket/browser-desktop/text", {
    method: "POST",
    body: JSON.stringify({ id, text }),
  });
}

/** Scrolls the page shown in the bot's live browser by about one screen. */
export async function scrollBrowser(id: string, direction: "up" | "down"): Promise<{ ok: boolean }> {
  return requestJson<{ ok: boolean }>("/api/pocket/browser-desktop/scroll", {
    method: "POST",
    body: JSON.stringify({ id, direction }),
  });
}

export async function savePocketSecret(
  key: string,
  value: string,
  profile?: string
): Promise<{ ok: boolean }> {
  return requestJson<{ ok: boolean }>("/api/pocket/secret", {
    method: "PUT",
    body: JSON.stringify({ key, value, ...(profile ? { profile } : {}) }),
  });
}

export async function transcribeAudioBlob(
  blob: Blob,
  profile?: string
): Promise<{ transcript: string; provider?: string }> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Audio konnte nicht gelesen werden."));
    reader.readAsDataURL(blob);
  });
  const params = new URLSearchParams();
  if (profile) params.set("profile", profile);
  const query = params.toString() ? `?${params.toString()}` : "";
  const res = await requestJson<{ ok?: boolean; transcript?: string; provider?: string }>(
    `/api/pocket/transcribe${query}`,
    {
      method: "POST",
      body: JSON.stringify({
        data_url: dataUrl,
        mime_type: blob.type || "audio/mp4",
        language: "de",
      }),
    }
  );
  return {
    transcript: typeof res.transcript === "string" ? res.transcript.trim() : "",
    provider: res.provider,
  };
}

export async function fetchSessionReactions(
  sessionId: string
): Promise<Record<string, string[]>> {
  try {
    const res = await requestJson<{ reactions?: Record<string, string[]> }>(
      `/api/pocket/reactions/${encodeURIComponent(sessionId)}`
    );
    return res.reactions || {};
  } catch {
    return {};
  }
}

export async function toggleSessionReaction(
  sessionId: string,
  msgKey: string,
  emoji: string
): Promise<Record<string, string[]>> {
  const res = await requestJson<{ reactions?: Record<string, string[]> }>(
    `/api/pocket/reactions/${encodeURIComponent(sessionId)}`,
    {
      method: "PUT",
      body: JSON.stringify({ msgKey, emoji }),
    }
  );
  return res.reactions || {};
}

export interface ProfileMediaGalleryItem {
  path: string;
  filename: string;
  kind: "image" | "audio" | "video" | "file";
  mime: string;
  size: number;
  mtimeMs: number;
  src: string;
  downloadUrl: string;
}

export async function fetchProfileMediaGallery(
  profileName: string
): Promise<ProfileMediaGalleryItem[]> {
  const data = await requestJson<{ items?: ProfileMediaGalleryItem[] }>(
    `/api/pocket/media/list?profile=${encodeURIComponent(profileName)}`
  );
  return Array.isArray(data.items) ? data.items : [];
}

export interface SavedBookmark {
  id: string;
  bot: string;
  author: string;
  text: string;
  sessionId?: string;
  createdAt: number;
}

export async function fetchBookmarks(): Promise<SavedBookmark[]> {
  const data = await requestJson<{ bookmarks?: SavedBookmark[] }>("/api/pocket/bookmarks");
  return Array.isArray(data.bookmarks) ? data.bookmarks : [];
}

export async function saveBookmark(payload: {
  bot: string;
  author: string;
  text: string;
  sessionId?: string;
}): Promise<SavedBookmark> {
  const data = await requestJson<{ bookmark: SavedBookmark }>("/api/pocket/bookmarks", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return data.bookmark;
}

export async function deleteBookmark(id: string): Promise<void> {
  await requestJson<{ ok: boolean }>(`/api/pocket/bookmarks/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}
