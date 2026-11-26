import type {
  HermesAuthUser,
  HermesChatMessage,
  HermesCronJob,
  HermesCronRun,
  HermesMessagingPlatform,
  HermesProfile,
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
    if (!content.trim() && !reasoning && role === "tool") continue;
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
  await requestJson(`/api/sessions/${encodeURIComponent(sessionId)}`, {
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
