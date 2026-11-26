import React, { useState } from "react";
import { AlertCircle, Lock, ShieldCheck } from "lucide-react";
import type { HermesStatusResponse } from "../../shared/types";
import { ApiError, passwordLogin } from "../lib/hermesApi";

interface LoginViewProps {
  status: HermesStatusResponse | null;
  statusError: string | null;
  onLoginSuccess: () => void;
}

export const LoginView: React.FC<LoginViewProps> = ({
  status,
  statusError,
  onLoginSuccess,
}) => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const primaryProvider = status?.auth_providers?.[0] || "basic";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError("Bitte Benutzername und Passwort eingeben.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await passwordLogin(username.trim(), password, primaryProvider);
      setPassword("");
      onLoginSuccess();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError("Anmeldung fehlgeschlagen. Benutzername oder Passwort stimmt nicht.");
      } else if (err instanceof ApiError && err.status === 429) {
        setError("Zu viele Anmeldeversuche. Bitte kurz warten.");
      } else {
        setError(err instanceof Error ? err.message : "Anmeldung fehlgeschlagen.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-shell">
      <div className="login-card">
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <img
            src="/icon.svg"
            alt="Hermes Pocket"
            width={48}
            height={48}
            style={{ borderRadius: 14, flexShrink: 0 }}
          />
          <div>
            <h1 style={{ margin: 0, fontSize: "1.28rem", fontWeight: 800, letterSpacing: "-0.02em" }}>
              Hermes Pocket
            </h1>
            <div style={{ fontSize: "0.82rem", color: "var(--text-secondary)", marginTop: 2 }}>
              Privater mobiler Zugang zu deinem Hermes Agent
            </div>
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          {status ? (
            <span className={`pill ${status.gateway_running ? "ok" : "warn"}`}>
              <span className="dot" />
              Hermes v{status.version} · {status.gateway_running ? "Gateway aktiv" : "Gateway pausiert"}
            </span>
          ) : statusError ? (
            <div className="notice err">
              <AlertCircle size={17} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>{statusError}</span>
            </div>
          ) : (
            <span className="pill">Verbinde mit Hermes-Server…</span>
          )}
        </div>

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="hp-username">Hermes-Benutzername</label>
            <input
              id="hp-username"
              className="input"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Benutzername"
              disabled={submitting}
              required
            />
          </div>

          <div className="field">
            <label htmlFor="hp-password">Passwort</label>
            <input
              id="hp-password"
              className="input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              disabled={submitting}
              required
            />
          </div>

          {error && (
            <div className="notice err" style={{ marginBottom: 12 }}>
              <AlertCircle size={17} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            className="btn primary full"
            disabled={submitting || Boolean(statusError && !status)}
          >
            <Lock size={16} />
            {submitting ? "Wird angemeldet…" : "Mit Hermes anmelden"}
          </button>
        </form>

        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
            marginTop: 16,
            paddingTop: 14,
            borderTop: "1px solid var(--border-subtle)",
            fontSize: "0.76rem",
            color: "var(--text-muted)",
            lineHeight: 1.45,
          }}
        >
          <ShieldCheck size={15} style={{ flexShrink: 0, marginTop: 2, color: "var(--status-ok)" }} />
          <span>
            Verwendet deine bestehende Hermes-Anmeldung über HttpOnly-Cookies. Passwörter werden
            weder im Browser noch im Repository gespeichert.
          </span>
        </div>
      </div>
    </div>
  );
};
