import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Mail,
  MessageCircle,
  RefreshCw,
  Settings2,
  ShieldCheck,
  TestTube2,
  X,
} from "lucide-react";
import type {
  HermesCronJob,
  HermesMessagingPlatform,
  HermesProfile,
} from "../../shared/types";
import { getBotVisual } from "../lib/botTheme";
import {
  fetchCronJobs,
  fetchMessagingPlatforms,
  testMessagingPlatform,
  updateMessagingPlatform,
} from "../lib/hermesApi";
import { Sheet } from "./Sheet";

interface EmailViewProps {
  profiles: HermesProfile[];
  onOpenBotChat: (profileName: string) => void;
}

const STATE_LABELS: Record<string, { label: string; tone: "ok" | "warn" | "err" | "" }> = {
  connected: { label: "Verbunden", tone: "ok" },
  disabled: { label: "Deaktiviert", tone: "warn" },
  not_configured: { label: "Nicht eingerichtet", tone: "warn" },
  pending_restart: { label: "Neustart ausstehend", tone: "warn" },
  gateway_stopped: { label: "Gateway gestoppt", tone: "warn" },
  disconnected: { label: "Getrennt", tone: "err" },
  startup_failed: { label: "Start fehlgeschlagen", tone: "err" },
  fatal: { label: "Fehler", tone: "err" },
};

export const EmailView: React.FC<EmailViewProps> = ({ profiles, onOpenBotChat }) => {
  const defaultProfile = useMemo(() => {
    if (profiles.some((p) => p.name === "mika")) return "mika";
    return profiles[0]?.name || "default";
  }, [profiles]);

  const [selectedProfile, setSelectedProfile] = useState<string>(defaultProfile);
  const [emailPlatform, setEmailPlatform] = useState<HermesMessagingPlatform | null>(null);
  const [profileJobs, setProfileJobs] = useState<HermesCronJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);

  const [showConfigSheet, setShowConfigSheet] = useState(false);
  const [envDraft, setEnvDraft] = useState<Record<string, string>>({});
  const [enabledDraft, setEnabledDraft] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  useEffect(() => {
    if (profiles.length > 0 && !profiles.some((p) => p.name === selectedProfile)) {
      setSelectedProfile(defaultProfile);
    }
  }, [defaultProfile, profiles, selectedProfile]);

  const loadEmailState = useCallback(async () => {
    setLoading(true);
    setError(null);
    setTestResult(null);
    try {
      const [platforms, jobs] = await Promise.all([
        fetchMessagingPlatforms(selectedProfile),
        fetchCronJobs(selectedProfile).catch(() => []),
      ]);
      const found =
        platforms.find((p) => p.id === "email") ||
        platforms.find((p) => p.id.toLowerCase().includes("mail")) ||
        null;
      setEmailPlatform(found);
      setProfileJobs(jobs);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "E-Mail-Status konnte nicht von Hermes geladen werden."
      );
    } finally {
      setLoading(false);
    }
  }, [selectedProfile]);

  useEffect(() => {
    void loadEmailState();
  }, [loadEmailState]);

  function openConfigSheet() {
    if (!emailPlatform) return;
    const nextDraft: Record<string, string> = {};
    for (const v of emailPlatform.env_vars) {
      // Never prefill password fields; only prefill non-secret saved values if present
      nextDraft[v.key] = !v.is_password && v.value ? v.value : "";
    }
    setEnvDraft(nextDraft);
    setEnabledDraft(emailPlatform.enabled);
    setSaveMessage(null);
    setShowConfigSheet(true);
  }

  async function handleSaveConfig(e: React.FormEvent) {
    e.preventDefault();
    if (!emailPlatform) return;
    setSaving(true);
    setError(null);
    setSaveMessage(null);
    try {
      const envPayload: Record<string, string> = {};
      for (const v of emailPlatform.env_vars) {
        const val = (envDraft[v.key] || "").trim();
        if (val) {
          envPayload[v.key] = val;
        }
      }
      await updateMessagingPlatform(
        emailPlatform.id,
        { enabled: enabledDraft, env: envPayload },
        selectedProfile
      );
      setShowConfigSheet(false);
      setSaveMessage("E-Mail-Einstellungen wurden sicher direkt in Hermes gespeichert.");
      await loadEmailState();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "E-Mail-Konfiguration konnte nicht gespeichert werden."
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleTestConnection() {
    if (!emailPlatform) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await testMessagingPlatform(emailPlatform.id, selectedProfile);
      const ok = res?.ok !== false && !res?.error;
      setTestResult({
        ok,
        text:
          res?.message ||
          res?.detail ||
          res?.error ||
          (ok ? "Verbindungstest erfolgreich." : "Verbindungstest fehlgeschlagen."),
      });
    } catch (err) {
      setTestResult({
        ok: false,
        text: err instanceof Error ? err.message : "Verbindungstest fehlgeschlagen.",
      });
    } finally {
      setTesting(false);
    }
  }

  const activeProfileObj = profiles.find((p) => p.name === selectedProfile);
  const activeVisual = activeProfileObj ? getBotVisual(activeProfileObj) : null;
  const stateMeta = emailPlatform
    ? STATE_LABELS[emailPlatform.state] || { label: emailPlatform.state || "Unbekannt", tone: "warn" }
    : { label: "Nicht verfügbar", tone: "warn" as const };

  return (
    <div>
      <div className="section-header" style={{ marginTop: 2 }}>
        <h2 className="section-title">Profil auswählen</h2>
        <button
          type="button"
          className="icon-btn ghost"
          aria-label="E-Mail-Status aktualisieren"
          style={{ minWidth: 34, minHeight: 34 }}
          onClick={() => void loadEmailState()}
        >
          <RefreshCw size={15} />
        </button>
      </div>

      <div className="chip-row" style={{ marginBottom: 14 }}>
        {profiles.map((p) => {
          const vis = getBotVisual(p);
          return (
            <button
              key={p.name}
              type="button"
              className={`chip ${selectedProfile === p.name ? "selected" : ""}`}
              onClick={() => setSelectedProfile(p.name)}
            >
              <span className="avatar xs" style={{ background: vis.gradient }}>
                {vis.initials}
              </span>
              {vis.label}
            </button>
          );
        })}
      </div>

      {saveMessage && (
        <div className="notice ok" style={{ marginBottom: 12 }}>
          <CheckCircle2 size={17} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>{saveMessage}</span>
        </div>
      )}

      {error && (
        <div className="notice err" style={{ marginBottom: 12 }}>
          <AlertCircle size={17} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="empty-state">
          <p>Prüfe E-Mail-Integration in Hermes…</p>
        </div>
      ) : !emailPlatform ? (
        <div className="empty-state">
          <Mail size={30} style={{ color: "var(--accent-primary)" }} />
          <h3>Keine E-Mail-Plattform gemeldet</h3>
          <p>
            Hermes liefert für Profil „{selectedProfile}“ aktuell keine E-Mail-Integration zurück.
          </p>
        </div>
      ) : (
        <div className="card-stack">
          <div className="card">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div
                  className="avatar sm"
                  style={{
                    background: activeVisual?.gradient || "linear-gradient(135deg, #f59e0b, #fb7185)",
                  }}
                >
                  <Mail size={17} color="#090b10" />
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: "0.98rem" }}>
                    E-Mail ({activeVisual?.label || selectedProfile})
                  </div>
                  <div style={{ fontSize: "0.78rem", color: "var(--text-secondary)" }}>
                    {emailPlatform.configured ? "Zugangsdaten hinterlegt" : "Zugangsdaten fehlen noch"}
                  </div>
                </div>
              </div>
              <span className={`pill ${stateMeta.tone}`}>
                <span className="dot" />
                {stateMeta.label}
              </span>
            </div>

            {emailPlatform.error_message && (
              <div className="notice err" style={{ marginTop: 12 }}>
                <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
                <span>{emailPlatform.error_message}</span>
              </div>
            )}

            <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 8 }}>
              {emailPlatform.env_vars
                .filter((v) => !v.advanced)
                .map((v) => (
                  <div
                    key={v.key}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 10,
                      padding: "8px 10px",
                      borderRadius: "var(--radius-sm)",
                      background: "rgba(255,255,255,0.03)",
                      border: "1px solid var(--border-subtle)",
                      fontSize: "0.82rem",
                    }}
                  >
                    <span style={{ color: "var(--text-secondary)" }}>{v.prompt || v.key}</span>
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: "0.76rem",
                        color: v.is_set ? "var(--status-ok)" : "var(--text-muted)",
                      }}
                    >
                      {v.is_set ? v.redacted_value || "gesetzt" : "nicht gesetzt"}
                    </span>
                  </div>
                ))}
            </div>

            {testResult && (
              <div className={`notice ${testResult.ok ? "ok" : "err"}`} style={{ marginTop: 12 }}>
                {testResult.ok ? (
                  <CheckCircle2 size={16} style={{ flexShrink: 0, marginTop: 2 }} />
                ) : (
                  <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
                )}
                <span>{testResult.text}</span>
              </div>
            )}

            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <button
                type="button"
                className="btn sm primary full"
                onClick={openConfigSheet}
              >
                <Settings2 size={15} /> Einrichten
              </button>
              <button
                type="button"
                className="btn sm full"
                disabled={testing || !emailPlatform.configured}
                onClick={() => void handleTestConnection()}
              >
                <TestTube2 size={15} /> {testing ? "Prüfe…" : "Verbindung testen"}
              </button>
            </div>
          </div>

          <div className="card">
            <div style={{ fontWeight: 700, fontSize: "0.92rem", marginBottom: 8 }}>
              Prüfliste vor Produktivbetrieb ({activeVisual?.label || selectedProfile})
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: "0.84rem", color: "var(--text-secondary)" }}>
              <div>
                {emailPlatform.configured ? "✓" : "○"} E-Mail-Zugang (IMAP/SMTP) direkt in Hermes
                hinterlegt
              </div>
              <div>
                {emailPlatform.state === "connected" || testResult?.ok ? "✓" : "○"} Verbindungstest
                erfolgreich durchgeführt
              </div>
              <div>
                {profileJobs.some((j) => j.enabled) ? "✓" : "○"} Zugehörige Mail-Routinen (
                {profileJobs.length}) geprüft – bleiben bis zur Freigabe pausiert
              </div>
            </div>

            <button
              type="button"
              className="btn full"
              style={{ marginTop: 14 }}
              onClick={() => onOpenBotChat(selectedProfile)}
            >
              <MessageCircle size={16} /> Mit {activeVisual?.label || selectedProfile} chatten
            </button>
          </div>

          <div className="notice">
            <ShieldCheck size={17} style={{ flexShrink: 0, marginTop: 2, color: "var(--status-ok)" }} />
            <span>
              Zugangsdaten werden über deine angemeldete Sitzung direkt an den Hermes-Server
              übergeben und niemals im Browser, in Logs oder in Git gespeichert.
            </span>
          </div>
        </div>
      )}

      <Sheet
        open={Boolean(showConfigSheet && emailPlatform)}
        onClose={() => {
          if (!saving) setShowConfigSheet(false);
        }}
      >
        {emailPlatform && (
          <>
            <div className="sheet-header">
              <h2 className="sheet-title">
                E-Mail für {activeVisual?.label || selectedProfile} konfigurieren
              </h2>
              <button
                type="button"
                className="icon-btn ghost"
                aria-label="Schließen"
                disabled={saving}
                onClick={() => setShowConfigSheet(false)}
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSaveConfig}>
              {emailPlatform.env_vars
                .filter((v) => !v.advanced)
                .map((v) => (
                  <div key={v.key} className="field">
                    <label htmlFor={`mail-${v.key}`}>
                      {v.prompt || v.key}
                      {v.is_set ? " (bereits gesetzt – leer lassen zum Beibehalten)" : ""}
                    </label>
                    <input
                      id={`mail-${v.key}`}
                      className="input"
                      type={v.is_password ? "password" : "text"}
                      autoCapitalize="none"
                      autoCorrect="off"
                      value={envDraft[v.key] || ""}
                      onChange={(e) =>
                        setEnvDraft((prev) => ({ ...prev, [v.key]: e.target.value }))
                      }
                      placeholder={v.description || v.key}
                    />
                  </div>
                ))}

              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  margin: "12px 0 16px",
                  fontSize: "0.88rem",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={enabledDraft}
                  onChange={(e) => setEnabledDraft(e.target.checked)}
                />
                <span>E-Mail-Plattform in Hermes aktivieren</span>
              </label>

              <button type="submit" className="btn primary full" disabled={saving}>
                {saving ? "Speichere in Hermes…" : "In Hermes speichern"}
              </button>
            </form>
          </>
        )}
      </Sheet>
    </div>
  );
};
