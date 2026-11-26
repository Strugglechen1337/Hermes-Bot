import React, { useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  Eye,
  EyeOff,
  HelpCircle,
  KeyRound,
  Lock,
  RefreshCw,
  Send,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import type {
  HermesClarifyQuestion,
  HermesFallbackProvider,
  HermesPendingApproval,
  HermesServerRequest,
  HermesUsageLimitError,
} from "../../shared/types";
import { saveProfileSecret } from "../lib/hermesApi";
import { formatResetCountdown } from "../lib/usageLimits";

// ── 1. Clarify (Interactive Yes/No & Multiple-Choice Card) ────────────────────

export function extractClarifyQuestions(req: HermesServerRequest): HermesClarifyQuestion[] {
  const rawList = req.params.questions;
  if (Array.isArray(rawList) && rawList.length > 0) {
    return rawList
      .map((item, idx): HermesClarifyQuestion | null => {
        if (!item || typeof item !== "object") return null;
        const rec = item as Record<string, unknown>;
        const q = typeof rec.question === "string" ? rec.question.trim() : "";
        if (!q) return null;
        const qid =
          typeof rec.qid === "string" && rec.qid.trim() ? rec.qid.trim() : `q${idx + 1}`;
        const choices = Array.isArray(rec.choices)
          ? rec.choices.filter((c): c is string => typeof c === "string" && c.trim().length > 0)
          : null;
        return {
          qid,
          question: q,
          choices: choices && choices.length > 0 ? choices : null,
          multi_select: Boolean(rec.multi_select),
        };
      })
      .filter((x): x is HermesClarifyQuestion => x !== null);
  }

  // Backwards-compatible single-question payload
  const singleQ =
    typeof req.params.question === "string" && req.params.question.trim()
      ? req.params.question.trim()
      : "Rückfrage des Bots";
  const singleChoices = Array.isArray(req.params.choices)
    ? req.params.choices.filter((c): c is string => typeof c === "string" && c.trim().length > 0)
    : null;
  return [
    {
      qid: "q1",
      question: singleQ,
      choices: singleChoices && singleChoices.length > 0 ? singleChoices : null,
      multi_select: Boolean(req.params.multi_select),
    },
  ];
}

interface ClarifyPromptCardProps {
  request: HermesServerRequest;
  botLabel: string;
  onSubmit: (answers: Record<string, string | null>, outcome: "submitted" | "cancelled") => void;
}

export const ClarifyPromptCard: React.FC<ClarifyPromptCardProps> = ({
  request,
  botLabel,
  onSubmit,
}) => {
  const questions = useMemo(() => extractClarifyQuestions(request), [request]);
  const isSingleQuestion = questions.length === 1;

  const [selectedSingle, setSelectedSingle] = useState<Record<string, string>>({});
  const [selectedMulti, setSelectedMulti] = useState<Record<string, string[]>>({});
  const [customText, setCustomText] = useState<Record<string, string>>({});

  function handleQuickPick(q: HermesClarifyQuestion, choice: string) {
    if (q.multi_select) {
      setSelectedMulti((prev) => {
        const cur = prev[q.qid] || [];
        const next = cur.includes(choice)
          ? cur.filter((c) => c !== choice)
          : [...cur, choice];
        return { ...prev, [q.qid]: next };
      });
      return;
    }

    // 1-tap instant submit when there is a single non-multi-select question
    if (isSingleQuestion) {
      onSubmit({ [q.qid]: choice }, "submitted");
      return;
    }

    setSelectedSingle((prev) => ({ ...prev, [q.qid]: choice }));
    setCustomText((prev) => ({ ...prev, [q.qid]: "" }));
  }

  function buildAnswers(): Record<string, string | null> {
    const out: Record<string, string | null> = {};
    for (const q of questions) {
      if (q.multi_select) {
        const picks = [...(selectedMulti[q.qid] || [])];
        const extra = (customText[q.qid] || "").trim();
        if (extra) picks.push(extra);
        out[q.qid] = picks.length > 0 ? picks.join(", ") : null;
      } else {
        const extra = (customText[q.qid] || "").trim();
        out[q.qid] = extra || selectedSingle[q.qid] || null;
      }
    }
    return out;
  }

  const hasAnyAnswer = questions.some((q) => {
    if (q.multi_select) {
      return (selectedMulti[q.qid]?.length || 0) > 0 || Boolean((customText[q.qid] || "").trim());
    }
    return Boolean(selectedSingle[q.qid]) || Boolean((customText[q.qid] || "").trim());
  });

  return (
    <div className="prompt-card clarify" role="region" aria-label={`Rückfrage von ${botLabel}`}>
      <div className="prompt-card-header">
        <div className="prompt-card-badge clarify">
          <HelpCircle size={15} />
          <span>Rückfrage von {botLabel}</span>
        </div>
        <button
          type="button"
          className="prompt-card-dismiss"
          aria-label="Rückfrage abbrechen"
          onClick={() => onSubmit({}, "cancelled")}
        >
          <X size={15} />
        </button>
      </div>

      <div className="prompt-card-body">
        {questions.map((q, idx) => {
          const choices = q.choices || [];
          const pickedMulti = selectedMulti[q.qid] || [];
          const pickedSingle = selectedSingle[q.qid] || "";

          return (
            <div key={q.qid} className="prompt-question-block">
              <div className="prompt-question-text">
                {!isSingleQuestion && (
                  <span className="prompt-question-num">{idx + 1}.</span>
                )}
                <span>{q.question}</span>
              </div>

              {choices.length > 0 && (
                <div className="prompt-choices">
                  {choices.map((choice) => {
                    const active = q.multi_select
                      ? pickedMulti.includes(choice)
                      : pickedSingle === choice;
                    const lower = choice.trim().toLowerCase();
                    const isYes = lower === "ja" || lower === "yes" || lower.startsWith("ja,");
                    const isNo = lower === "nein" || lower === "no" || lower.startsWith("nein,");
                    return (
                      <button
                        key={choice}
                        type="button"
                        className={`prompt-choice-btn ${active ? "selected" : ""} ${isYes ? "yes" : isNo ? "no" : ""}`}
                        onClick={() => handleQuickPick(q, choice)}
                      >
                        <span className="prompt-choice-label">{choice}</span>
                        {active && <Check size={15} className="prompt-choice-check" />}
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="prompt-custom-row">
                <input
                  className="prompt-input"
                  value={customText[q.qid] || ""}
                  onChange={(e) => {
                    const val = e.target.value;
                    setCustomText((prev) => ({ ...prev, [q.qid]: val }));
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && isSingleQuestion && !q.multi_select) {
                      const val = (customText[q.qid] || "").trim();
                      if (val) {
                        e.preventDefault();
                        onSubmit({ [q.qid]: val }, "submitted");
                      }
                    }
                  }}
                  placeholder={
                    choices.length > 0 ? "Oder eigene Antwort eingeben…" : "Antwort eingeben…"
                  }
                />
                {isSingleQuestion && !q.multi_select && (
                  <button
                    type="button"
                    className="btn sm primary"
                    disabled={!(customText[q.qid] || "").trim()}
                    onClick={() => {
                      const val = (customText[q.qid] || "").trim();
                      if (val) onSubmit({ [q.qid]: val }, "submitted");
                    }}
                  >
                    <Send size={14} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {(!isSingleQuestion || questions.some((q) => q.multi_select)) && (
        <div className="prompt-card-footer">
          <button
            type="button"
            className="btn sm"
            onClick={() => onSubmit({}, "cancelled")}
          >
            Abbrechen
          </button>
          <button
            type="button"
            className="btn sm primary"
            disabled={!hasAnyAnswer}
            onClick={() => onSubmit(buildAnswers(), "submitted")}
          >
            <Check size={14} /> Antwort senden
          </button>
        </div>
      )}
    </div>
  );
};

// ── 2. Approval (Clickable Yes / Session / Always / No Card) ──────────────────

interface ApprovalPromptCardProps {
  approval: HermesPendingApproval;
  botLabel: string;
  onDecide: (choice: "once" | "session" | "always" | "deny") => Promise<void> | void;
}

export const ApprovalPromptCard: React.FC<ApprovalPromptCardProps> = ({
  approval,
  botLabel,
  onDecide,
}) => {
  const [busyChoice, setBusyChoice] = useState<string | null>(null);

  const kind = approval.kind || "command";
  const title =
    kind === "access"
      ? "Ordner-Zugriff erlauben?"
      : kind === "network"
        ? "Netzwerk-Zugriff erlauben?"
        : "Aktion freigeben?";

  const targetSummary =
    approval.command ||
    approval.path ||
    approval.host ||
    approval.tool_name ||
    null;

  const choices = Array.isArray(approval.choices) ? approval.choices : [];
  const allowSession =
    approval.allow_session !== false &&
    (choices.length === 0 || choices.includes("session"));
  const allowPermanent =
    Boolean(approval.allow_permanent) || choices.includes("always");

  async function pick(choice: "once" | "session" | "always" | "deny") {
    if (busyChoice) return;
    setBusyChoice(choice);
    try {
      await onDecide(choice);
    } finally {
      setBusyChoice(null);
    }
  }

  return (
    <div className="prompt-card approval" role="region" aria-label="Freigabe angefordert">
      <div className="prompt-card-header">
        <div className="prompt-card-badge approval">
          <ShieldAlert size={15} />
          <span>{title}</span>
        </div>
        <span className="prompt-card-meta">{botLabel}</span>
      </div>

      <div className="prompt-card-body">
        <p className="prompt-description">
          {approval.description ||
            approval.label ||
            "Der Bot möchte eine geschützte Aktion ausführen."}
        </p>

        {targetSummary && (
          <div className="prompt-code-box">
            <code>{targetSummary}</code>
          </div>
        )}

        {approval.risk && (
          <div className="prompt-risk-note">
            <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>{approval.risk}</span>
          </div>
        )}
      </div>

      <div className="prompt-action-grid">
        <button
          type="button"
          className="prompt-choice-btn yes"
          disabled={Boolean(busyChoice)}
          onClick={() => void pick("once")}
        >
          <Check size={15} />
          <span>{busyChoice === "once" ? "Wird freigegeben…" : "Ja, einmal erlauben"}</span>
        </button>

        {allowSession && (
          <button
            type="button"
            className="prompt-choice-btn"
            disabled={Boolean(busyChoice)}
            onClick={() => void pick("session")}
          >
            <ShieldCheck size={15} />
            <span>Für diesen Chat erlauben</span>
          </button>
        )}

        {allowPermanent && (
          <button
            type="button"
            className="prompt-choice-btn"
            disabled={Boolean(busyChoice)}
            onClick={() => void pick("always")}
          >
            <Sparkles size={15} />
            <span>Immer erlauben</span>
          </button>
        )}

        <button
          type="button"
          className="prompt-choice-btn no"
          disabled={Boolean(busyChoice)}
          onClick={() => void pick("deny")}
        >
          <X size={15} />
          <span>Nein, ablehnen</span>
        </button>
      </div>
    </div>
  );
};

// ── 3. Secure Password / API-Key / 2FA Prompt Card (Server Request) ──────────

export const SECRET_REQUEST_METHODS = new Set([
  "secret",
  "sudo",
  "vault.unlock_prompt",
  "vault.save_login",
  "vault.code",
]);

interface SecretPromptCardProps {
  request: HermesServerRequest;
  botLabel: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

export const SecretPromptCard: React.FC<SecretPromptCardProps> = ({
  request,
  botLabel,
  onSubmit,
  onCancel,
}) => {
  const [secretValue, setSecretValue] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [showValue, setShowValue] = useState(false);

  const method = request.method;
  const p = request.params;

  const isLoginSave = method === "vault.save_login";
  const isCode = method === "vault.code";

  let title = "Sichere Abfrage";
  let subtitle = "";
  let keyBadge: string | null = null;
  let placeholder = "Passwort oder API-Key eingeben…";

  if (method === "secret") {
    const envVar = typeof p.env_var === "string" ? p.env_var : "";
    const prompt = typeof p.prompt === "string" ? p.prompt : "";
    title = "API-Key / Passwort angefordert";
    keyBadge = envVar || null;
    subtitle = prompt || `Bitte gib den Wert für ${envVar || "diesen Schlüssel"} ein.`;
    placeholder = envVar ? `Wert für ${envVar}…` : "Geheimen Wert eingeben…";
  } else if (method === "sudo") {
    const cmd = typeof p.command === "string" ? p.command : "";
    title = "System-Passwort (sudo)";
    subtitle = cmd ? `Erforderlich für Befehl: ${cmd}` : "Der Befehl benötigt dein System-Passwort.";
    placeholder = "System-Passwort…";
  } else if (method === "vault.unlock_prompt") {
    const display = typeof p.display_name === "string" ? p.display_name : "Passwort-Tresor";
    title = `${display} entsperren`;
    subtitle = "Master-Passwort für diese Sitzung eingeben.";
    placeholder = "Master-Passwort…";
  } else if (method === "vault.save_login") {
    const site = typeof p.site === "string" ? p.site : typeof p.origin === "string" ? p.origin : "Dienst";
    title = `Zugangsdaten für ${site}`;
    subtitle = "Sicher an den Hermes-Tresor übermitteln (erscheint nicht im Chat).";
    placeholder = "Passwort…";
  } else if (method === "vault.code") {
    const site = typeof p.site === "string" ? p.site : "";
    const hint = typeof p.hint === "string" ? p.hint : "";
    title = site ? `Bestätigungscode (${site})` : "Einmalcode / 2FA";
    subtitle = hint || "Gib den aktuellen Bestätigungscode ein.";
    placeholder = "z. B. 123456";
  }

  function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isLoginSave) {
      if (!identifier.trim() || !secretValue) return;
      const payload = JSON.stringify({
        identifier: identifier.trim(),
        password: secretValue,
      });
      setIdentifier("");
      setSecretValue("");
      onSubmit(payload);
      return;
    }
    if (!secretValue.trim()) return;
    const val = secretValue;
    setSecretValue("");
    onSubmit(val);
  }

  return (
    <form
      className="prompt-card secret"
      role="region"
      aria-label={title}
      onSubmit={handleFormSubmit}
      autoComplete="off"
    >
      <div className="prompt-card-header">
        <div className="prompt-card-badge secret">
          <Lock size={14} />
          <span>{title}</span>
        </div>
        <button
          type="button"
          className="prompt-card-dismiss"
          aria-label="Abbrechen"
          onClick={() => {
            setSecretValue("");
            setIdentifier("");
            onCancel();
          }}
        >
          <X size={15} />
        </button>
      </div>

      <div className="prompt-card-body">
        <p className="prompt-description">{subtitle}</p>
        {keyBadge && (
          <div className="prompt-key-pill">
            <KeyRound size={12} />
            <code>{keyBadge}</code>
          </div>
        )}

        {isLoginSave && (
          <input
            className="prompt-input"
            type="text"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            placeholder="Benutzername oder E-Mail…"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            style={{ marginBottom: 8 }}
          />
        )}

        <div className="secret-input-wrap">
          <input
            className="prompt-input"
            type={isCode || showValue ? "text" : "password"}
            inputMode={isCode ? "numeric" : "text"}
            autoComplete={isCode ? "one-time-code" : "off"}
            autoCapitalize="none"
            spellCheck={false}
            value={secretValue}
            onChange={(e) => setSecretValue(e.target.value)}
            placeholder={placeholder}
            style={{ paddingRight: isCode ? 12 : 42 }}
          />
          {!isCode && (
            <button
              type="button"
              className="secret-eye-btn"
              aria-label={showValue ? "Verbergen" : "Anzeigen"}
              onClick={() => setShowValue((v) => !v)}
            >
              {showValue ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          )}
        </div>

        <div className="prompt-security-footnote">
          <ShieldCheck size={13} />
          <span>
            Direkt verschlüsselt an {botLabel} · wird nicht im Chatverlauf gespeichert.
          </span>
        </div>
      </div>

      <div className="prompt-card-footer">
        <button
          type="button"
          className="btn sm"
          onClick={() => {
            setSecretValue("");
            setIdentifier("");
            onCancel();
          }}
        >
          Abbrechen
        </button>
        <button
          type="submit"
          className="btn sm primary"
          disabled={isLoginSave ? !identifier.trim() || !secretValue : !secretValue.trim()}
        >
          <Lock size={13} /> Sicher senden
        </button>
      </div>
    </form>
  );
};

// ── 4. Proactive Inline Manual Secret Box (/secret or + menu) ─────────────────

interface ManualSecretCardProps {
  profileName: string;
  botLabel: string;
  initialKey?: string;
  onSaved: (keyName: string) => void;
  onClose: () => void;
}

const COMMON_SECRET_PRESETS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GITHUB_TOKEN",
  "BRAVE_API_KEY",
];

export const ManualSecretCard: React.FC<ManualSecretCardProps> = ({
  profileName,
  botLabel,
  initialKey = "",
  onSaved,
  onClose,
}) => {
  const [keyName, setKeyName] = useState(initialKey.toUpperCase());
  const [secretValue, setSecretValue] = useState("");
  const [showValue, setShowValue] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const cleanKey = keyName.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_");
    if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(cleanKey)) {
      setError("Bitte gültigen Schlüsselnamen angeben (z. B. GITHUB_TOKEN).");
      return;
    }
    if (!secretValue.trim()) {
      setError("Bitte ein Passwort oder einen API-Key eingeben.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await saveProfileSecret(profileName, cleanKey, secretValue);
      setSecretValue("");
      onSaved(cleanKey);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Konnte nicht gespeichert werden.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="prompt-card secret" onSubmit={(e) => void handleSave(e)} autoComplete="off">
      <div className="prompt-card-header">
        <div className="prompt-card-badge secret">
          <KeyRound size={14} />
          <span>Passwort / API-Key sicher hinterlegen</span>
        </div>
        <button
          type="button"
          className="prompt-card-dismiss"
          aria-label="Schließen"
          disabled={saving}
          onClick={onClose}
        >
          <X size={15} />
        </button>
      </div>

      <div className="prompt-card-body">
        <p className="prompt-description">
          Wird direkt im geschützten <code>.env</code>-Speicher von {botLabel} abgelegt und
          erscheint niemals im Chatverlauf.
        </p>

        <div className="chip-row" style={{ marginBottom: 8 }}>
          {COMMON_SECRET_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              className={`chip ${keyName === preset ? "selected" : ""}`}
              style={{ minHeight: 28, fontSize: "0.72rem", padding: "0 9px" }}
              onClick={() => setKeyName(preset)}
            >
              {preset}
            </button>
          ))}
        </div>

        <input
          className="prompt-input"
          value={keyName}
          onChange={(e) => setKeyName(e.target.value.toUpperCase())}
          placeholder="Variablenname (z. B. MY_SERVICE_API_KEY)"
          autoCapitalize="characters"
          spellCheck={false}
          style={{ marginBottom: 8 }}
          disabled={saving}
        />

        <div className="secret-input-wrap">
          <input
            className="prompt-input"
            type={showValue ? "text" : "password"}
            value={secretValue}
            onChange={(e) => setSecretValue(e.target.value)}
            placeholder="Passwort oder API-Key…"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            style={{ paddingRight: 42 }}
            disabled={saving}
          />
          <button
            type="button"
            className="secret-eye-btn"
            aria-label={showValue ? "Verbergen" : "Anzeigen"}
            onClick={() => setShowValue((v) => !v)}
          >
            {showValue ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>

        {error && (
          <div style={{ marginTop: 8, fontSize: "0.8rem", color: "var(--status-err)" }}>
            {error}
          </div>
        )}
      </div>

      <div className="prompt-card-footer">
        <button type="button" className="btn sm" disabled={saving} onClick={onClose}>
          Abbrechen
        </button>
        <button
          type="submit"
          className="btn sm primary"
          disabled={saving || !keyName.trim() || !secretValue.trim()}
        >
          <Lock size={13} /> {saving ? "Speichere…" : "Sicher speichern"}
        </button>
      </div>
    </form>
  );
};

// ── 5. Rate / Plan Limit Hit Card with 1-Tap Anthropic Switch ────────────────

interface UsageLimitCardProps {
  limitError: HermesUsageLimitError;
  fallbackTarget: HermesFallbackProvider;
  switching: boolean;
  onSwitchToFallback: () => void;
  onOpenModelPicker: () => void;
  onDismiss: () => void;
}

export const UsageLimitCard: React.FC<UsageLimitCardProps> = ({
  limitError,
  fallbackTarget,
  switching,
  onSwitchToFallback,
  onOpenModelPicker,
  onDismiss,
}) => {
  const resetCountdown = formatResetCountdown(limitError.resets_at_ms);

  return (
    <div className="prompt-card limit" role="alert">
      <div className="prompt-card-header">
        <div className="prompt-card-badge approval">
          <AlertTriangle size={15} />
          <span>{limitError.limit_name || "Chat-Limit erreicht"}</span>
        </div>
        <button
          type="button"
          className="prompt-card-dismiss"
          aria-label="Hinweis schließen"
          onClick={onDismiss}
        >
          <X size={15} />
        </button>
      </div>

      <div className="prompt-card-body">
        <p className="prompt-description">
          {limitError.message || "Das aktuelle Kontingent dieses Modells ist erschöpft."}
          {resetCountdown ? ` Reset ${resetCountdown}.` : ""}
        </p>
      </div>

      <div className="prompt-action-grid">
        <button
          type="button"
          className="prompt-choice-btn yes"
          disabled={switching}
          onClick={onSwitchToFallback}
        >
          <RefreshCw size={15} />
          <span>
            {switching
              ? "Wechsle auf Fallback…"
              : `Auf ${fallbackTarget.provider} (${fallbackTarget.model}) wechseln`}
          </span>
        </button>
        <button
          type="button"
          className="prompt-choice-btn"
          disabled={switching}
          onClick={onOpenModelPicker}
        >
          <span>Anderes Modell wählen…</span>
        </button>
      </div>
    </div>
  );
};
