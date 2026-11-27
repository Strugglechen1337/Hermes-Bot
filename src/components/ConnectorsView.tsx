import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Home,
  Link2,
  Mail,
  Plug,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  Trash2,
  Zap,
} from "lucide-react";
import type {
  HermesConnectionTarget,
  HermesConnectorAccount,
  HermesConnectorCatalogRow,
  HermesConnectorRow,
  HermesMcpCatalogEntry,
  HermesMcpServer,
  HermesProfile,
} from "../../shared/types";
import { getBotVisual } from "../lib/botTheme";
import {
  cancelMcpOAuthFlow,
  fetchMcpCatalog,
  fetchMcpServers,
  installMcpCatalogEntry,
  pollMcpOAuthFlow,
  savePocketSecret,
  startMcpServerAuth,
  testMcpServer,
  testMessagingPlatform,
  toggleMcpServer,
  updateMessagingPlatform,
} from "../lib/hermesApi";
import { hermesWs, type WsConnectionState } from "../lib/hermesWs";
import { BotAvatar } from "./BotAvatar";
import { EmailView } from "./EmailView";

interface ConnectorsViewProps {
  profiles: HermesProfile[];
  avatars: Record<string, string>;
  wsState: WsConnectionState;
  onOpenBotChat: (profileName: string) => void;
}

type SubTab = "connectors" | "mcp" | "email";

export const ConnectorsView: React.FC<ConnectorsViewProps> = ({
  profiles,
  avatars,
  wsState,
  onOpenBotChat,
}) => {
  const defaultProfile = useMemo(() => {
    if (profiles.some((p) => p.name === "mika")) return "mika";
    return profiles[0]?.name || "default";
  }, [profiles]);

  const [subTab, setSubTab] = useState<SubTab>("connectors");
  const [selectedProfile, setSelectedProfile] = useState<string>(defaultProfile);
  const [search, setSearch] = useState("");

  // Hosted Connectors (WS RPC)
  const [hostedAvailable, setHostedAvailable] = useState<boolean>(true);
  const [connectorRows, setConnectorRows] = useState<HermesConnectorRow[]>([]);
  const [catalog, setCatalog] = useState<HermesConnectorCatalogRow[]>([]);
  const [accounts, setAccounts] = useState<HermesConnectorAccount[]>([]);
  const [loadingHosted, setLoadingHosted] = useState(true);
  const [hostedError, setHostedError] = useState<string | null>(null);
  const [connectingSlug, setConnectingSlug] = useState<string | null>(null);
  const [pendingLink, setPendingLink] = useState<{
    slug: string;
    url: string;
    note?: string;
    flowId?: string;
  } | null>(null);
  const [copiedAuthUrl, setCopiedAuthUrl] = useState(false);

  // Quick Home Assistant (HASS_URL + HASS_TOKEN) inline setup
  const [showHassForm, setShowHassForm] = useState(false);
  const [hassUrl, setHassUrl] = useState("");
  const [hassToken, setHassToken] = useState("");
  const [savingHass, setSavingHass] = useState(false);
  const [hassFeedback, setHassFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  // MCP Servers (REST)
  const [mcpServers, setMcpServers] = useState<HermesMcpServer[]>([]);
  const [mcpCatalog, setMcpCatalog] = useState<HermesMcpCatalogEntry[]>([]);
  const [loadingMcp, setLoadingMcp] = useState(true);
  const [mcpError, setMcpError] = useState<string | null>(null);
  const [busyMcp, setBusyMcp] = useState<string | null>(null);
  const [mcpNotice, setMcpNotice] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (profiles.length > 0 && !profiles.some((p) => p.name === selectedProfile)) {
      setSelectedProfile(defaultProfile);
    }
  }, [defaultProfile, profiles, selectedProfile]);

  const loadHostedConnectors = useCallback(async () => {
    if (wsState !== "connected") {
      setLoadingHosted(false);
      return;
    }
    setLoadingHosted(true);
    setHostedError(null);
    try {
      const [listRes, catRes, accRes] = await Promise.all([
        hermesWs
          .call<{ available?: boolean; connectors?: HermesConnectorRow[] }>("connectors.list", {
            profile: selectedProfile,
            owner: { type: "account" },
          })
          .catch(() => null),
        hermesWs
          .call<{ connectors?: HermesConnectorCatalogRow[] }>("connectors.catalog", {
            profile: selectedProfile,
          })
          .catch(() => null),
        hermesWs
          .call<{ accounts?: HermesConnectorAccount[] }>("connectors.accounts", {
            profile: selectedProfile,
          })
          .catch(() => null),
      ]);

      setHostedAvailable(listRes ? Boolean(listRes.available) : Boolean(catRes?.connectors?.length));
      setConnectorRows(Array.isArray(listRes?.connectors) ? listRes.connectors : []);
      setCatalog(Array.isArray(catRes?.connectors) ? catRes.connectors : []);
      setAccounts(Array.isArray(accRes?.accounts) ? accRes.accounts : []);
    } catch (err) {
      setHostedError(
        err instanceof Error ? err.message : "Hermes-Connectoren konnten nicht geladen werden."
      );
    } finally {
      setLoadingHosted(false);
    }
  }, [selectedProfile, wsState]);

  const loadMcp = useCallback(async () => {
    setLoadingMcp(true);
    setMcpError(null);
    try {
      const [servers, cat] = await Promise.all([
        fetchMcpServers(selectedProfile),
        fetchMcpCatalog(selectedProfile).catch(() => []),
      ]);
      setMcpServers(servers);
      setMcpCatalog(cat);
    } catch (err) {
      setMcpError(err instanceof Error ? err.message : "MCP-Server konnten nicht geladen werden.");
    } finally {
      setLoadingMcp(false);
    }
  }, [selectedProfile]);

  useEffect(() => {
    void loadHostedConnectors();
    void loadMcp();
  }, [loadHostedConnectors, loadMcp]);

  const [quickSetupInfo, setQuickSetupInfo] = useState<{
    label: string;
    envKey?: string;
    placeholder?: string;
    emailPreset?: "gmail" | "outlook";
    hint: string;
  } | null>(null);
  const [quickTokenVal, setQuickTokenVal] = useState("");
  const [quickEmailAddr, setQuickEmailAddr] = useState("");
  const [quickEmailPass, setQuickEmailPass] = useState("");
  const [savingQuickToken, setSavingQuickToken] = useState(false);

  async function handleConnectHosted(slug: string, reconnect = false) {
    setConnectingSlug(slug);
    setHostedError(null);
    setPendingLink(null);
    try {
      const res = await hermesWs.call<{
        targets?: HermesConnectionTarget[];
        note?: string;
      }>("connectors.connect", {
        profile: selectedProfile,
        owner: { type: "account" },
        connectors: [slug],
        reconnect,
      });
      const target = res?.targets?.find((t) => t.connect_url) || res?.targets?.[0];
      if (target?.connect_url) {
        setPendingLink({
          slug,
          url: target.connect_url,
          note: target.instructions || res?.note,
        });
        window.open(target.connect_url, "_blank", "noopener,noreferrer");
      } else {
        await loadHostedConnectors();
      }
    } catch (err) {
      setHostedError(
        err instanceof Error ? err.message : `Verbindung für ${slug} konnte nicht gestartet werden.`
      );
    } finally {
      setConnectingSlug(null);
    }
  }

  async function handleRemoveAccount(connectionId: string) {
    setConnectingSlug(connectionId);
    setHostedError(null);
    try {
      await hermesWs.call("connectors.accounts.remove", {
        profile: selectedProfile,
        connection_id: connectionId,
      });
      await loadHostedConnectors();
    } catch (err) {
      setHostedError(err instanceof Error ? err.message : "Konto konnte nicht getrennt werden.");
    } finally {
      setConnectingSlug(null);
    }
  }

  async function handleToggleMcp(server: HermesMcpServer) {
    setBusyMcp(server.name);
    setMcpNotice(null);
    try {
      await toggleMcpServer(server.name, server.enabled === false, selectedProfile);
      await loadMcp();
    } catch (err) {
      setMcpNotice({
        ok: false,
        text: err instanceof Error ? err.message : "Status konnte nicht geändert werden.",
      });
    } finally {
      setBusyMcp(null);
    }
  }

  async function handleTestMcp(name: string) {
    setBusyMcp(name);
    setMcpNotice(null);
    try {
      const res = await testMcpServer(name, selectedProfile);
      const ok = res?.ok !== false && !res?.error;
      setMcpNotice({
        ok,
        text: ok
          ? `${name}: verbunden${typeof res?.tool_count === "number" ? ` (${res.tool_count} Tools)` : ""}.`
          : `${name}: ${res?.error || res?.detail || "Verbindung fehlgeschlagen."}`,
      });
    } catch (err) {
      setMcpNotice({
        ok: false,
        text: err instanceof Error ? err.message : `${name}: Test fehlgeschlagen.`,
      });
    } finally {
      setBusyMcp(null);
    }
  }

  useEffect(() => {
    const flowId = pendingLink?.flowId;
    if (!flowId) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      void pollMcpOAuthFlow(flowId)
        .then((snap) => {
          if (cancelled) return;
          const url = snap.authorization_url || snap.auth_url || snap.authorize_url || snap.url;
          if (url && pendingLink && !pendingLink.url) {
            setPendingLink((prev) => (prev ? { ...prev, url } : prev));
          }
          if (snap.status === "connected" || snap.status === "completed" || snap.status === "done") {
            setPendingLink(null);
            setMcpNotice({
              ok: true,
              text: `${snap.server_name || pendingLink?.slug || "Dienst"} erfolgreich per OAuth verbunden!`,
            });
            void loadMcp();
          } else if (snap.status === "error" || snap.status === "failed" || snap.status === "cancelled") {
            setPendingLink(null);
            setMcpNotice({
              ok: false,
              text: snap.error || "OAuth-Anmeldung abgebrochen oder fehlgeschlagen.",
            });
          }
        })
        .catch(() => null);
    }, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [pendingLink?.flowId, loadMcp]);

  async function handleAuthMcp(name: string) {
    setBusyMcp(name);
    setMcpNotice(null);
    try {
      const res = await startMcpServerAuth(name, selectedProfile);
      const authUrl = res?.authorization_url || res?.auth_url || res?.authorize_url || res?.url;
      if (res?.error) {
        setMcpNotice({ ok: false, text: `${name}: ${res.error}` });
      } else if (authUrl) {
        setPendingLink({
          slug: name,
          url: authUrl,
          flowId: res?.flow_id,
          note: res?.message || "Tippe auf „In Safari anmelden“ und schließe den Login ab.",
        });
        setMcpNotice({
          ok: true,
          text: `OAuth-Anmeldelink für ${name} bereit – tippe oben auf „In Safari anmelden“.`,
        });
      } else if (res?.flow_id) {
        setPendingLink({
          slug: name,
          url: "",
          flowId: res.flow_id,
          note: "Warte auf OAuth-Anmeldelink vom Server…",
        });
      } else {
        setMcpNotice({
          ok: true,
          text: res?.message || `Authentifizierung für ${name} gestartet.`,
        });
      }
    } catch (err) {
      setMcpNotice({
        ok: false,
        text: err instanceof Error ? err.message : `${name}: OAuth konnte nicht gestartet werden.`,
      });
    } finally {
      setBusyMcp(null);
    }
  }

  async function handleInstallCatalogMcp(entry: HermesMcpCatalogEntry) {
    setBusyMcp(entry.name);
    setMcpNotice(null);
    try {
      await installMcpCatalogEntry(entry.name, selectedProfile);
      setMcpNotice({ ok: true, text: `${entry.display_name || entry.name} wurde hinzugefügt.` });
      await loadMcp();
    } catch (err) {
      setMcpNotice({
        ok: false,
        text: err instanceof Error ? err.message : "Installation fehlgeschlagen.",
      });
    } finally {
      setBusyMcp(null);
    }
  }

  // Merge hosted catalog + connector rows cleanly
  const mergedConnectors = useMemo(() => {
    const bySlug = new Map<
      string,
      {
        slug: string;
        name: string;
        description: string;
        category: string;
        connected: boolean;
        status: string | null;
        reason: string | null;
      }
    >();

    for (const c of catalog) {
      bySlug.set(c.slug, {
        slug: c.slug,
        name: c.name || c.slug,
        description: c.description || "",
        category: c.category || "Connector",
        connected: false,
        status: null,
        reason: null,
      });
    }
    for (const r of connectorRows) {
      const existing = bySlug.get(r.connector);
      bySlug.set(r.connector, {
        slug: r.connector,
        name: existing?.name || r.connector,
        description: existing?.description || "",
        category: existing?.category || "Connector",
        connected: Boolean(r.connected),
        status: r.connection_status,
        reason: r.status_reason,
      });
    }

    const q = search.trim().toLowerCase();
    return Array.from(bySlug.values())
      .filter(
        (item) =>
          !q ||
          item.name.toLowerCase().includes(q) ||
          item.slug.toLowerCase().includes(q) ||
          item.description.toLowerCase().includes(q) ||
          item.category.toLowerCase().includes(q)
      )
      .sort((a, b) => Number(b.connected) - Number(a.connected) || a.name.localeCompare(b.name, "de"));
  }, [catalog, connectorRows, search]);

  const filteredMcpServers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return mcpServers;
    return mcpServers.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        String(s.url || "").toLowerCase().includes(q)
    );
  }, [mcpServers, search]);

  const uninstalledMcpCatalog = useMemo(() => {
    const installedNames = new Set(mcpServers.map((s) => s.name));
    const q = search.trim().toLowerCase();
    return mcpCatalog.filter(
      (e) =>
        !e.installed &&
        !installedNames.has(e.name) &&
        (!q ||
          e.name.toLowerCase().includes(q) ||
          (e.display_name || "").toLowerCase().includes(q) ||
          (e.description || "").toLowerCase().includes(q))
    );
  }, [mcpCatalog, mcpServers, search]);

  const TOP_OAUTH_SERVICES = [
    {
      label: "Gmail",
      aliases: ["gmail", "google-mail", "google_workspace", "google"],
      emailPreset: "gmail" as const,
      hint: "Einfach Gmail-Adresse & 16-stelliges Google App-Passwort einfügen – IMAP/SMTP werden automatisch konfiguriert und getestet.",
    },
    {
      label: "Google Kalender",
      aliases: ["google_calendar", "google-calendar", "calendar", "gcal"],
      hint: "Starte die Google-Kalender-OAuth-Einrichtung direkt über deinen Bot im Chat oder füge einen passenden MCP-Server im Tab „MCP“ hinzu.",
    },
    {
      label: "Google Drive",
      aliases: ["google_drive", "google-drive", "drive"],
      hint: "Verbinde Google Drive über einen MCP-Server im Tab „MCP“ oder direkt mit deinem Bot im Chat.",
    },
    {
      label: "Outlook / M365",
      aliases: ["outlook", "microsoft", "office365"],
      emailPreset: "outlook" as const,
      hint: "Einfach Outlook-Adresse & App-Passwort einfügen – IMAP/SMTP werden automatisch konfiguriert.",
    },
    {
      label: "GitHub",
      aliases: ["github"],
      envKey: "GITHUB_TOKEN",
      placeholder: "ghp_… oder github_pat_…",
      hint: "Hinterlege direkt ein GitHub Personal Access Token (GITHUB_TOKEN) Write-Only in der Server-.env.",
    },
    {
      label: "Notion",
      aliases: ["notion"],
      envKey: "NOTION_API_KEY",
      placeholder: "ntn_… oder secret_…",
      hint: "Hinterlege deinen Notion Integration Token (NOTION_API_KEY) Write-Only in der Server-.env.",
    },
    {
      label: "Spotify",
      aliases: ["spotify"],
      hint: "Verbinde Spotify über einen MCP-Server im Tab „MCP“ oder über deinen Bot im Chat.",
    },
    {
      label: "Slack",
      aliases: ["slack"],
      envKey: "SLACK_BOT_TOKEN",
      placeholder: "xoxb-…",
      hint: "Hinterlege dein Slack Bot Token (SLACK_BOT_TOKEN) Write-Only in der Server-.env.",
    },
  ];

  async function handleQuickOAuthService(svc: (typeof TOP_OAUTH_SERVICES)[number]) {
    setHostedError(null);
    setHassFeedback(null);
    setQuickSetupInfo(null);
    setQuickTokenVal("");
    setQuickEmailPass("");
    setConnectingSlug(svc.label);
    try {
      // Gmail & Outlook: open the instant App-Passwort form directly (fastest & most reliable on self-hosted Hermes)
      if (svc.emailPreset) {
        setQuickSetupInfo({
          label: svc.label,
          emailPreset: svc.emailPreset,
          hint: svc.hint,
        });
        return;
      }

      // 1. Prefer matching Hermes Hosted Connector (if available on this instance)
      const hostedMatch = mergedConnectors.find((c) => {
        const hay = `${c.slug} ${c.name}`.toLowerCase();
        return svc.aliases.some((a) => hay.includes(a));
      });
      if (hostedMatch) {
        await handleConnectHosted(hostedMatch.slug, hostedMatch.connected);
        return;
      }

      // 2. Fallback: matching installed MCP server (starts OAuth flow)
      const mcpInstalled = mcpServers.find((s) =>
        svc.aliases.some((a) => s.name.toLowerCase().includes(a))
      );
      if (mcpInstalled) {
        setSubTab("mcp");
        await handleAuthMcp(mcpInstalled.name);
        return;
      }

      // 3. Fallback: matching MCP catalog entry -> install & start OAuth
      const mcpCat = mcpCatalog.find((e) => {
        const hay = `${e.name} ${e.display_name || ""}`.toLowerCase();
        return svc.aliases.some((a) => hay.includes(a));
      });
      if (mcpCat) {
        setSubTab("mcp");
        await handleInstallCatalogMcp(mcpCat);
        await handleAuthMcp(mcpCat.name);
        return;
      }

      // 4. Honest, actionable inline setup card (never silently do nothing)
      setQuickSetupInfo({
        label: svc.label,
        envKey: svc.envKey,
        placeholder: svc.placeholder,
        hint: svc.hint,
      });
    } finally {
      setConnectingSlug(null);
    }
  }

  async function handleSaveQuickEmail(e: React.FormEvent) {
    e.preventDefault();
    if (!quickSetupInfo?.emailPreset) return;
    const addr = quickEmailAddr.trim();
    const pass = quickEmailPass.replace(/\s+/g, "").trim();
    if (!addr || !pass) return;
    setSavingQuickToken(true);
    setHostedError(null);
    setHassFeedback(null);
    try {
      const isGmail = quickSetupInfo.emailPreset === "gmail";
      const envPayload: Record<string, string> = {
        EMAIL_ADDRESS: addr,
        EMAIL_PASSWORD: pass,
        EMAIL_IMAP_HOST: isGmail ? "imap.gmail.com" : "outlook.office365.com",
        EMAIL_IMAP_PORT: "993",
        EMAIL_SMTP_HOST: isGmail ? "smtp.gmail.com" : "smtp.office365.com",
        EMAIL_SMTP_PORT: "587",
      };
      await updateMessagingPlatform("email", { enabled: true, env: envPayload }, selectedProfile);
      // Mirror address & app password into profile .env for scripts/skills as well
      await savePocketSecret("EMAIL_ADDRESS", addr, selectedProfile).catch(() => null);
      await savePocketSecret("EMAIL_PASSWORD", pass, selectedProfile).catch(() => null);
      setQuickEmailPass("");

      const testRes = await testMessagingPlatform("email", selectedProfile).catch(() => null);
      const ok = testRes ? testRes.ok !== false && !testRes.error : true;
      setHassFeedback({
        ok,
        text: ok
          ? `${quickSetupInfo.label} (${addr}) erfolgreich verbunden & getestet für ${selectedProfile}!`
          : `Gespeichert, aber Verbindungstest meldet: ${testRes?.error || testRes?.detail || "Bitte App-Passwort prüfen."}`,
      });
      if (ok) {
        setQuickSetupInfo(null);
      }
    } catch (err) {
      setHostedError(
        err instanceof Error ? err.message : "E-Mail-Konfiguration konnte nicht gespeichert werden."
      );
    } finally {
      setSavingQuickToken(false);
    }
  }

  async function handleSaveHass(e: React.FormEvent) {
    e.preventDefault();
    if (!hassToken.trim()) return;
    setSavingHass(true);
    setHassFeedback(null);
    try {
      if (hassUrl.trim()) {
        await savePocketSecret("HASS_URL", hassUrl.trim(), selectedProfile);
      }
      await savePocketSecret("HASS_TOKEN", hassToken.trim(), selectedProfile);
      setHassToken("");
      setHassFeedback({
        ok: true,
        text: `Gespeichert als HASS_TOKEN${hassUrl.trim() ? " & HASS_URL" : ""} für ${selectedProfile}.`,
      });
    } catch (err) {
      setHassFeedback({
        ok: false,
        text: err instanceof Error ? err.message : "Konnte Home Assistant nicht speichern.",
      });
    } finally {
      setSavingHass(false);
    }
  }

  return (
    <div>
      {/* Clean segmented sub-navigation */}
      <div className="segmented" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={subTab === "connectors"}
          className={`segmented-item ${subTab === "connectors" ? "active" : ""}`}
          onClick={() => setSubTab("connectors")}
        >
          <Plug size={14} /> Connectoren
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={subTab === "mcp"}
          className={`segmented-item ${subTab === "mcp" ? "active" : ""}`}
          onClick={() => setSubTab("mcp")}
        >
          <Server size={14} /> MCP ({mcpServers.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={subTab === "email"}
          className={`segmented-item ${subTab === "email" ? "active" : ""}`}
          onClick={() => setSubTab("email")}
        >
          <Mail size={14} /> E-Mail
        </button>
      </div>

      {subTab === "email" ? (
        <EmailView profiles={profiles} onOpenBotChat={onOpenBotChat} />
      ) : (
        <>
          <div className="section-header" style={{ marginTop: 12 }}>
            <h2 className="section-title">Bot-Profil</h2>
            <button
              type="button"
              className="icon-btn ghost"
              aria-label="Aktualisieren"
              style={{ minWidth: 34, minHeight: 34 }}
              onClick={() =>
                subTab === "connectors" ? void loadHostedConnectors() : void loadMcp()
              }
            >
              <RefreshCw size={15} />
            </button>
          </div>

          <div className="chip-row" style={{ marginBottom: 12 }}>
            {profiles.map((p) => {
              const vis = getBotVisual(p);
            
  return (
                <button
                  key={p.name}
                  type="button"
                  className={`chip ${selectedProfile === p.name ? "selected" : ""}`}
                  onClick={() => setSelectedProfile(p.name)}
                >
                  <BotAvatar visual={vis} imageUrl={avatars[p.name]} size="xs" />
                  {vis.label}
                </button>
              );
            })}
          </div>

          <div style={{ position: "relative", marginBottom: 14 }}>
            <Search
              size={15}
              style={{
                position: "absolute",
                left: 13,
                top: "50%",
                transform: "translateY(-50%)",
                color: "var(--text-muted)",
                pointerEvents: "none",
              }}
            />
            <input
              className="input"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={
                subTab === "connectors"
                  ? "Connectoren suchen (z. B. Gmail, Kalender, GitHub)…"
                  : "MCP-Server suchen…"
              }
              style={{ paddingLeft: 38, borderRadius: "var(--radius-pill)" }}
            />
          </div>

          {pendingLink && (
            <div className="notice ok" style={{ marginBottom: 12 }}>
              <ExternalLink size={17} style={{ flexShrink: 0, marginTop: 2 }} />
              <div style={{ flex: 1 }}>
                <div>
                  <strong>OAuth-Anmeldung für {pendingLink.slug} bereit</strong>
                  {pendingLink.note ? ` – ${pendingLink.note}` : ""}
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                  {pendingLink.url && (
                    <>
                      <a
                        href={pendingLink.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn sm primary"
                        style={{ textDecoration: "none" }}
                      >
                        In Safari anmelden <ExternalLink size={13} />
                      </a>
                      <button
                        type="button"
                        className="btn sm"
                        onClick={() => {
                          void navigator.clipboard?.writeText(pendingLink.url).then(() => {
                            setCopiedAuthUrl(true);
                            window.setTimeout(() => setCopiedAuthUrl(false), 1800);
                          });
                        }}
                      >
                        {copiedAuthUrl ? <Check size={13} /> : <Copy size={13} />}
                        {copiedAuthUrl ? "Link kopiert" : "Link kopieren"}
                      </button>
                    </>
                  )}
                  {pendingLink.flowId && (
                    <button
                      type="button"
                      className="btn sm"
                      onClick={() => {
                        const fid = pendingLink.flowId!;
                        setPendingLink(null);
                        void cancelMcpOAuthFlow(fid).catch(() => null);
                      }}
                    >
                      Abbrechen
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {subTab === "connectors" && (
            <>
              {!search.trim() && (
                <div className="card" style={{ marginBottom: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
                    <div style={{ fontWeight: 700, fontSize: "0.9rem" }}>
                      Top-Dienste schnell verbinden (OAuth)
                    </div>
                    <button
                      type="button"
                      className="btn sm"
                      onClick={() => {
                        setShowHassForm((v) => !v);
                        setHassFeedback(null);
                      }}
                    >
                      <Home size={13} /> Home Assistant
                    </button>
                  </div>
                  <div className="chip-row">
                    {TOP_OAUTH_SERVICES.map((svc) => (
                      <button
                        key={svc.label}
                        type="button"
                        className={`chip ${quickSetupInfo?.label === svc.label ? "selected" : ""}`}
                        disabled={Boolean(connectingSlug || busyMcp)}
                        onClick={() => void handleQuickOAuthService(svc)}
                      >
                        <Link2 size={12} />
                        {connectingSlug === svc.label ? `${svc.label}…` : svc.label}
                      </button>
                    ))}
                  </div>

                  {quickSetupInfo && (
                    <div
                      style={{
                        marginTop: 12,
                        paddingTop: 12,
                        borderTop: "1px solid var(--border-subtle)",
                      }}
                    >
                      <div style={{ fontWeight: 700, fontSize: "0.86rem", marginBottom: 4 }}>
                        {quickSetupInfo.label} verbinden
                      </div>
                      <p style={{ margin: "0 0 10px", fontSize: "0.8rem", color: "var(--text-secondary)", lineHeight: 1.45 }}>
                        {quickSetupInfo.hint}
                      </p>

                      {quickSetupInfo.emailPreset && (
                        <form onSubmit={handleSaveQuickEmail} style={{ marginBottom: 10 }}>
                          <div className="field">
                            <label htmlFor="quick-email-addr">E-Mail-Adresse</label>
                            <input
                              id="quick-email-addr"
                              type="email"
                              className="input"
                              autoComplete="email"
                              value={quickEmailAddr}
                              onChange={(e) => setQuickEmailAddr(e.target.value)}
                              placeholder={
                                quickSetupInfo.emailPreset === "gmail"
                                  ? "deinname@gmail.com"
                                  : "deinname@outlook.de"
                              }
                            />
                          </div>
                          <div className="field">
                            <label htmlFor="quick-email-pass">
                              App-Passwort{" "}
                              {quickSetupInfo.emailPreset === "gmail" && (
                                <a
                                  href="https://myaccount.google.com/apppasswords"
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  style={{ marginLeft: 6, fontSize: "0.75rem" }}
                                >
                                  (bei Google erstellen ↗)
                                </a>
                              )}
                            </label>
                            <input
                              id="quick-email-pass"
                              type="password"
                              className="input"
                              autoComplete="off"
                              value={quickEmailPass}
                              onChange={(e) => setQuickEmailPass(e.target.value)}
                              placeholder="xxxx xxxx xxxx xxxx"
                            />
                          </div>
                          <button
                            type="submit"
                            className="btn primary sm full"
                            disabled={savingQuickToken || !quickEmailAddr.trim() || !quickEmailPass.trim()}
                          >
                            <ShieldCheck size={14} />{" "}
                            {savingQuickToken ? "Speichere & teste…" : `${quickSetupInfo.label} verbinden & testen`}
                          </button>
                        </form>
                      )}

                      {quickSetupInfo.envKey && (
                        <form
                          onSubmit={async (e) => {
                            e.preventDefault();
                            if (!quickTokenVal.trim() || !quickSetupInfo.envKey) return;
                            setSavingQuickToken(true);
                            try {
                              await savePocketSecret(
                                quickSetupInfo.envKey,
                                quickTokenVal.trim(),
                                selectedProfile
                              );
                              setQuickTokenVal("");
                              setHassFeedback({
                                ok: true,
                                text: `${quickSetupInfo.envKey} sicher für ${selectedProfile} gespeichert.`,
                              });
                              setQuickSetupInfo(null);
                            } catch (err) {
                              setHostedError(
                                err instanceof Error ? err.message : "Token konnte nicht gespeichert werden."
                              );
                            } finally {
                              setSavingQuickToken(false);
                            }
                          }}
                          style={{ marginBottom: 10 }}
                        >
                          <div className="field">
                            <label htmlFor="quick-svc-token">
                              <code>{quickSetupInfo.envKey}</code>
                            </label>
                            <input
                              id="quick-svc-token"
                              type="password"
                              className="input"
                              autoComplete="off"
                              value={quickTokenVal}
                              onChange={(e) => setQuickTokenVal(e.target.value)}
                              placeholder={quickSetupInfo.placeholder || "Token eingeben…"}
                            />
                          </div>
                          <button
                            type="submit"
                            className="btn primary sm full"
                            disabled={savingQuickToken || !quickTokenVal.trim()}
                          >
                            <ShieldCheck size={14} />{" "}
                            {savingQuickToken ? "Speichere…" : `${quickSetupInfo.envKey} sicher speichern`}
                          </button>
                        </form>
                      )}

                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {quickSetupInfo.emailPreset && (
                          <button
                            type="button"
                            className="btn sm"
                            onClick={() => {
                              setQuickSetupInfo(null);
                              setSubTab("email");
                            }}
                          >
                            <Mail size={13} /> Alle E-Mail-Details
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn sm"
                          onClick={() => {
                            setQuickSetupInfo(null);
                            setSubTab("mcp");
                          }}
                        >
                          <Server size={13} /> MCP-Server ansehen
                        </button>
                        <button
                          type="button"
                          className="btn sm"
                          onClick={() => {
                            setQuickSetupInfo(null);
                            onOpenBotChat(selectedProfile);
                          }}
                        >
                          Im Bot-Chat einrichten
                        </button>
                      </div>
                    </div>
                  )}

                  {showHassForm && (
                    <form
                      onSubmit={handleSaveHass}
                      style={{
                        marginTop: 12,
                        paddingTop: 12,
                        borderTop: "1px solid var(--border-subtle)",
                      }}
                    >
                      <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: 8 }}>
                        Speichert direkt als <code>HASS_URL</code> &amp; <code>HASS_TOKEN</code> (Write-Only in der geschützten Server-<code>.env</code>).
                      </div>
                      <div className="field">
                        <label htmlFor="hass-url-input">Home Assistant URL (<code>HASS_URL</code>)</label>
                        <input
                          id="hass-url-input"
                          type="url"
                          className="input"
                          value={hassUrl}
                          onChange={(e) => setHassUrl(e.target.value)}
                          placeholder="http://homeassistant.local:8123"
                        />
                      </div>
                      <div className="field">
                        <label htmlFor="hass-token-input">Long-Lived Access Token (<code>HASS_TOKEN</code>)</label>
                        <input
                          id="hass-token-input"
                          type="password"
                          className="input"
                          autoComplete="off"
                          value={hassToken}
                          onChange={(e) => setHassToken(e.target.value)}
                          placeholder="eyJhbGciOiJIUzI1NiIs…"
                        />
                      </div>
                      {hassFeedback && (
                        <div className={`notice ${hassFeedback.ok ? "ok" : "err"}`} style={{ marginBottom: 8 }}>
                          <span>{hassFeedback.text}</span>
                        </div>
                      )}
                      <button
                        type="submit"
                        className="btn primary sm full"
                        disabled={savingHass || !hassToken.trim()}
                      >
                        <ShieldCheck size={14} /> {savingHass ? "Speichere…" : "HASS_TOKEN sicher speichern"}
                      </button>
                    </form>
                  )}
                </div>
              )}

              {hostedError && (
                <div className="notice err" style={{ marginBottom: 12 }}>
                  <AlertCircle size={17} style={{ flexShrink: 0, marginTop: 2 }} />
                  <span>{hostedError}</span>
                </div>
              )}

              {accounts.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div className="section-header">
                    <h3 className="section-title">Verbundene Konten ({accounts.length})</h3>
                  </div>
                  <div className="card-stack">
                    {accounts.map((acc) => (
                      <div key={acc.connection_id} className="card" style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: "0.92rem" }}>
                            {acc.label || acc.alias || acc.connector}
                          </div>
                          <div style={{ fontSize: "0.78rem", color: "var(--text-secondary)", marginTop: 2 }}>
                            {acc.connector} · {acc.status}
                          </div>
                        </div>
                        <span className={`pill ${acc.active ? "ok" : "warn"}`}>
                          {acc.active ? "Aktiv" : acc.status}
                        </span>
                        <button
                          type="button"
                          className="icon-btn ghost"
                          aria-label="Konto entfernen"
                          disabled={connectingSlug === acc.connection_id}
                          onClick={() => void handleRemoveAccount(acc.connection_id)}
                        >
                          <Trash2 size={16} style={{ color: "var(--text-muted)" }} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="section-header">
                <h3 className="section-title">
                  Hermes Connectoren ({mergedConnectors.length})
                </h3>
              </div>

              {loadingHosted ? (
                <div className="empty-state">
                  <p>Lade Hermes-Connectoren…</p>
                </div>
              ) : mergedConnectors.length === 0 ? (
                <div className="empty-state">
                  <Plug size={28} style={{ color: "var(--text-secondary)" }} />
                  <h3>
                    {hostedAvailable
                      ? "Keine passenden Connectoren"
                      : "Hosted Connectoren nicht aktiviert"}
                  </h3>
                  <p>
                    {hostedAvailable
                      ? "Kein Connector passt zum Suchbegriff."
                      : "Für dieses Profil sind aktuell keine Hosted-Connectoren aktiv. Wechsle oben auf „MCP“ oder „E-Mail“, um deine eingerichteten Hermes-MCP-Server und E-Mail-Zugänge zu verwalten."}
                  </p>
                  <button
                    type="button"
                    className="btn sm primary"
                    onClick={() => setSubTab("mcp")}
                  >
                    Zu MCP-Servern wechseln
                  </button>
                </div>
              ) : (
                <div className="card-stack">
                  {mergedConnectors.map((item) => (
                    <div key={item.slug} className="card">
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontWeight: 700, fontSize: "0.95rem" }}>{item.name}</div>
                          {item.description && (
                            <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginTop: 3 }}>
                              {item.description}
                            </div>
                          )}
                        </div>
                        <span className={`pill ${item.connected ? "ok" : ""}`}>
                          <span className="dot" />
                          {item.connected ? "Verbunden" : item.status || "Getrennt"}
                        </span>
                      </div>

                      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                        <button
                          type="button"
                          className={`btn sm full ${item.connected ? "" : "primary"}`}
                          disabled={connectingSlug === item.slug}
                          onClick={() => void handleConnectHosted(item.slug, item.connected)}
                        >
                          <Link2 size={14} />
                          {connectingSlug === item.slug
                            ? "Starte…"
                            : item.connected
                              ? "Neu verbinden"
                              : "Verbinden"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {subTab === "mcp" && (
            <>
              {mcpNotice && (
                <div className={`notice ${mcpNotice.ok ? "ok" : "err"}`} style={{ marginBottom: 12 }}>
                  {mcpNotice.ok ? (
                    <CheckCircle2 size={17} style={{ flexShrink: 0, marginTop: 2 }} />
                  ) : (
                    <AlertCircle size={17} style={{ flexShrink: 0, marginTop: 2 }} />
                  )}
                  <span>{mcpNotice.text}</span>
                </div>
              )}

              {mcpError && (
                <div className="notice err" style={{ marginBottom: 12 }}>
                  <AlertCircle size={17} style={{ flexShrink: 0, marginTop: 2 }} />
                  <span>{mcpError}</span>
                </div>
              )}

              <div className="section-header">
                <h3 className="section-title">Eingerichtete MCP-Server ({filteredMcpServers.length})</h3>
              </div>

              {loadingMcp ? (
                <div className="empty-state">
                  <p>Lade MCP-Server aus Hermes…</p>
                </div>
              ) : filteredMcpServers.length === 0 ? (
                <div className="empty-state">
                  <Server size={28} style={{ color: "var(--text-secondary)" }} />
                  <h3>Keine MCP-Server gefunden</h3>
                  <p>Für Profil „{selectedProfile}“ sind derzeit keine passenden MCP-Server konfiguriert.</p>
                </div>
              ) : (
                <div className="card-stack">
                  {filteredMcpServers.map((srv) => {
                    const isEnabled = srv.enabled !== false;
                    const busy = busyMcp === srv.name;
                  
  return (
                      <div key={srv.name} className="card">
                        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontWeight: 700, fontSize: "0.94rem" }}>{srv.name}</div>
                            <div style={{ fontSize: "0.78rem", color: "var(--text-secondary)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {srv.url || srv.command || srv.transport || "MCP-Server"}
                            </div>
                          </div>
                          <span className={`pill ${isEnabled ? "ok" : "warn"}`}>
                            <span className="dot" />
                            {isEnabled ? "Aktiv" : "Aus"}
                          </span>
                        </div>

                        {srv.error && (
                          <div className="notice err" style={{ marginTop: 10, padding: "8px 10px" }}>
                            <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
                            <span>{srv.error}</span>
                          </div>
                        )}

                        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                          <button
                            type="button"
                            className="btn sm full"
                            disabled={busy}
                            onClick={() => void handleToggleMcp(srv)}
                          >
                            {isEnabled ? "Deaktivieren" : "Aktivieren"}
                          </button>
                          <button
                            type="button"
                            className="btn sm full"
                            disabled={busy}
                            onClick={() => void handleTestMcp(srv.name)}
                          >
                            <Zap size={14} /> Testen
                          </button>
                          {(srv.oauth_supported || srv.auth_type === "oauth" || srv.url) && (
                            <button
                              type="button"
                              className="btn sm primary"
                              disabled={busy}
                              onClick={() => void handleAuthMcp(srv.name)}
                            >
                              <Link2 size={14} /> Auth
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {uninstalledMcpCatalog.length > 0 && (
                <>
                  <div className="section-header" style={{ marginTop: 20 }}>
                    <h3 className="section-title">
                      MCP-Katalog ({uninstalledMcpCatalog.length})
                    </h3>
                  </div>
                  <div className="card-stack">
                    {uninstalledMcpCatalog.map((entry) => (
                      <div key={entry.name} className="card" style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: "0.92rem" }}>
                            {entry.display_name || entry.title || entry.name}
                          </div>
                          {entry.description && (
                            <div style={{ fontSize: "0.78rem", color: "var(--text-secondary)", marginTop: 2 }}>
                              {entry.description}
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          className="btn sm primary"
                          disabled={busyMcp === entry.name}
                          onClick={() => void handleInstallCatalogMcp(entry)}
                        >
                          {busyMcp === entry.name ? "…" : "Hinzufügen"}
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
};
