import React, { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  Check,
  ExternalLink,
  Link2,
  RefreshCw,
  X,
} from "lucide-react";
import type {
  HermesConnectionRequest,
  HermesConnectionTarget,
} from "../../shared/types";
import { hermesWs } from "../lib/hermesWs";

interface InChatConnectionCardProps {
  profileName: string;
  sessionId: string;
  request: HermesConnectionRequest;
  onUpdated: (next: HermesConnectionRequest | null) => void;
}

export const InChatConnectionCard: React.FC<InChatConnectionCardProps> = ({
  profileName,
  sessionId,
  request,
  onUpdated,
}) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [envValues, setEnvValues] = useState<Record<string, Record<string, string>>>({});

  const owner = { type: "session" as const, session_id: sessionId };

  const wakeAndRefresh = useCallback(async () => {
    try {
      await hermesWs
        .call("connectors.operation.wake", {
          profile: profileName,
          owner,
          op_id: request.op_id,
        })
        .catch(() => null);
      const status = await hermesWs.call<HermesConnectionRequest>(
        "connectors.operation.status",
        {
          profile: profileName,
          owner,
          op_id: request.op_id,
        }
      );
      if (status?.settled) {
        onUpdated(null);
      } else if (status?.targets) {
        onUpdated(status);
      }
    } catch {
      // Ignore transient wake errors while backgrounded
    }
  }, [onUpdated, profileName, request.op_id, sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Automatically wake Hermes when user returns from Safari OAuth login
  useEffect(() => {
    const onResume = () => {
      if (document.visibilityState === "visible") {
        void wakeAndRefresh();
      }
    };
    document.addEventListener("visibilitychange", onResume);
    window.addEventListener("focus", onResume);
    return () => {
      document.removeEventListener("visibilitychange", onResume);
      window.removeEventListener("focus", onResume);
    };
  }, [wakeAndRefresh]);

  async function handleTargetAnswer(
    target: HermesConnectionTarget,
    status: "approved" | "skipped"
  ) {
    setBusy(true);
    setError(null);
    try {
      const targetEnv = envValues[target.name];
      const cleanedEnv =
        targetEnv && Object.keys(targetEnv).length > 0
          ? Object.fromEntries(
              Object.entries(targetEnv).filter(([, v]) => v.trim().length > 0)
            )
          : undefined;

      const res = await hermesWs.call<{ settled?: boolean }>("connection.respond", {
        profile: profileName,
        owner,
        op_id: request.op_id,
        result: {
          targets: [
            {
              name: target.name,
              status,
              ...(cleanedEnv && Object.keys(cleanedEnv).length > 0 ? { env: cleanedEnv } : {}),
            },
          ],
        },
      });
      if (res?.settled) {
        onUpdated(null);
      } else {
        await wakeAndRefresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Antwort konnte nicht gesendet werden.");
    } finally {
      setBusy(false);
    }
  }

  async function handleReconnect(targetName: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await hermesWs.call<HermesConnectionRequest>("connectors.connect", {
        profile: profileName,
        owner,
        connectors: [targetName],
        reconnect: true,
      });
      if (res?.targets) {
        onUpdated(res);
        const refreshed = res.targets.find((t) => t.name === targetName && t.connect_url);
        if (refreshed?.connect_url) {
          window.open(refreshed.connect_url, "_blank", "noopener,noreferrer");
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Link konnte nicht erneuert werden.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSettle(reason: "continue" | "cancel") {
    setBusy(true);
    setError(null);
    try {
      const res = await hermesWs.call<{ settled?: boolean }>("connection.respond", {
        profile: profileName,
        owner,
        op_id: request.op_id,
        result: {
          targets: [],
          settled_by: reason,
        },
      });
      if (res?.settled || reason === "cancel") {
        onUpdated(null);
      } else {
        await wakeAndRefresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Aktion fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ borderColor: "rgba(165, 180, 252, 0.36)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: "0.94rem" }}>
          <Link2 size={16} style={{ color: "var(--accent-indigo)" }} />
          <span>Integration verbinden</span>
        </div>
        <button
          type="button"
          className="icon-btn ghost"
          aria-label="Status prüfen"
          disabled={busy}
          style={{ minWidth: 32, minHeight: 32 }}
          onClick={() => void wakeAndRefresh()}
        >
          <RefreshCw size={14} />
        </button>
      </div>

      {error && (
        <div className="notice err" style={{ marginBottom: 10, padding: "8px 10px" }}>
          <AlertCircle size={15} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>{error}</span>
        </div>
      )}

      <div className="card-stack">
        {request.targets.map((target) => {
          const isDone =
            target.resolved === true ||
            target.state === "connected" ||
            target.state === "active" ||
            target.state === "approved";
          const needsApproval =
            !isDone &&
            !target.connect_url &&
            (target.state === "awaiting_approval" ||
              target.state === "needs_approval" ||
              target.state === "needs_env" ||
              Boolean(target.required_env && target.required_env.length > 0));
          const isFailed =
            target.state === "failed" || target.state === "expired" || target.state === "error";

          return (
            <div
              key={target.name}
              style={{
                padding: "10px 12px",
                borderRadius: "var(--radius-sm)",
                background: "rgba(255,255,255,0.03)",
                border: "1px solid var(--border-subtle)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <div style={{ fontWeight: 700, fontSize: "0.9rem" }}>
                  {target.display || target.name}
                </div>
                <span className={`pill ${isDone ? "ok" : isFailed ? "err" : "accent"}`}>
                  {isDone ? "Verbunden" : target.state}
                </span>
              </div>

              {(target.instructions || target.detail || target.description) && (
                <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginTop: 4, lineHeight: 1.4 }}>
                  {target.instructions || target.detail || target.description}
                </div>
              )}

              {target.required_env && target.required_env.length > 0 && !isDone && (
                <div style={{ marginTop: 10 }}>
                  {target.required_env.map((field) => (
                    <div key={field.name} className="field" style={{ marginBottom: 8 }}>
                      <label>{field.prompt || field.name}</label>
                      <input
                        className="input"
                        type={field.secret ? "password" : "text"}
                        autoCapitalize="none"
                        autoCorrect="off"
                        value={envValues[target.name]?.[field.name] || ""}
                        onChange={(e) =>
                          setEnvValues((prev) => ({
                            ...prev,
                            [target.name]: {
                              ...(prev[target.name] || {}),
                              [field.name]: e.target.value,
                            },
                          }))
                        }
                        placeholder={field.name}
                      />
                    </div>
                  ))}
                </div>
              )}

              {!isDone && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                  {target.connect_url && (
                    <a
                      href={target.connect_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn sm primary"
                      style={{ textDecoration: "none", flex: 1 }}
                    >
                      Anmelden <ExternalLink size={13} />
                    </a>
                  )}

                  {target.connect_url && (
                    <button
                      type="button"
                      className="btn sm"
                      disabled={busy}
                      onClick={() => void wakeAndRefresh()}
                    >
                      <Check size={14} /> Fertig
                    </button>
                  )}

                  {needsApproval && (
                    <>
                      <button
                        type="button"
                        className="btn sm primary"
                        style={{ flex: 1 }}
                        disabled={busy}
                        onClick={() => void handleTargetAnswer(target, "approved")}
                      >
                        <Check size={14} /> Erlauben
                      </button>
                      <button
                        type="button"
                        className="btn sm"
                        disabled={busy}
                        onClick={() => void handleTargetAnswer(target, "skipped")}
                      >
                        <X size={14} /> Überspringen
                      </button>
                    </>
                  )}

                  {isFailed && (
                    <button
                      type="button"
                      className="btn sm primary"
                      disabled={busy}
                      onClick={() => void handleReconnect(target.name)}
                    >
                      <RefreshCw size={13} /> Erneut versuchen
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button
          type="button"
          className="btn sm full"
          disabled={busy}
          onClick={() => void handleSettle("cancel")}
        >
          Abbrechen
        </button>
        <button
          type="button"
          className="btn sm primary full"
          disabled={busy}
          onClick={() => void handleSettle("continue")}
        >
          Weiter im Chat
        </button>
      </div>
    </div>
  );
};
