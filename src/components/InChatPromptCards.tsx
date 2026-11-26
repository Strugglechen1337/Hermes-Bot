import React, { useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  CreditCard,
  ExternalLink,
  Eye,
  EyeOff,
  HelpCircle,
  KeyRound,
  Lock,
  MapPin,
  RefreshCw,
  Send,
  ShieldAlert,
  ShieldCheck,
  ShoppingBag,
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
import {
  isPlaintextFormFieldKey,
  type DetectedDealCard,
  type DetectedSecretRequest,
  type DetectedVaultRequest,
} from "../lib/secretDetection";
import { formatResetCountdown } from "../lib/usageLimits";
import {
  addVaultItem,
  addVaultItemToProfiles,
  buildSafeCardLabel,
  type VaultAddPayload,
} from "../lib/vaultClient";

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

// ── 4. Proactive Inline Manual Secret Box & Multi-Field Secure Form ──────────

interface ManualSecretCardProps {
  profileName: string;
  botLabel: string;
  formTitle?: string;
  initialKey?: string;
  promptText?: string;
  fields?: DetectedSecretRequest[];
  onSaved: (savedKeys: string[], envPathHint?: string) => void;
  onClose: () => void;
}

const COMMON_SECRET_PRESETS = [
  "HASS_TOKEN",
  "GITHUB_TOKEN",
  "FRITZBOX_PASSWORD",
  "BRAVE_API_KEY",
];

export const ManualSecretCard: React.FC<ManualSecretCardProps> = ({
  profileName,
  botLabel,
  formTitle,
  initialKey = "",
  promptText,
  fields,
  onSaved,
  onClose,
}) => {
  const isMultiField = Array.isArray(fields) && fields.length > 1;
  const [keyName, setKeyName] = useState(initialKey.toUpperCase());
  const [secretValue, setSecretValue] = useState("");
  const [showValue, setShowValue] = useState(false);
  const [multiValues, setMultiValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    if (Array.isArray(fields)) {
      for (const f of fields) init[f.keyName] = "";
    }
    return init;
  });
  const [visibleKeys, setVisibleKeys] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    if (Array.isArray(fields)) {
      for (const f of fields) init[f.keyName] = isPlaintextFormFieldKey(f.keyName);
    }
    return init;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allMultiFilled = isMultiField
    ? fields.every((f) => Boolean((multiValues[f.keyName] || "").trim()))
    : false;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (isMultiField && fields) {
      const missing = fields.find((f) => !(multiValues[f.keyName] || "").trim());
      if (missing) {
        setError(`Bitte fülle das Feld „${missing.prompt || missing.keyName}“ aus.`);
        return;
      }
      setSaving(true);
      setError(null);
      try {
        const savedKeys: string[] = [];
        let envPathHint: string | undefined;
        for (const field of fields) {
          const val = multiValues[field.keyName] || "";
          const res = await saveProfileSecret(profileName, field.keyName, val);
          savedKeys.push(field.keyName);
          if (res.envPathHint) envPathHint = res.envPathHint;
        }
        setMultiValues({});
        onSaved(savedKeys, envPathHint);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Formular konnte nicht gespeichert werden.");
      } finally {
        setSaving(false);
      }
      return;
    }

    const cleanKey = keyName.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_");
    if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(cleanKey)) {
      setError("Bitte gültigen Schlüsselnamen angeben (z. B. HASS_TOKEN).");
      return;
    }
    if (!secretValue.trim()) {
      setError("Bitte ein Passwort oder einen API-Key eingeben.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await saveProfileSecret(profileName, cleanKey, secretValue);
      setSecretValue("");
      onSaved([cleanKey], res.envPathHint);
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
          <span>
            {formTitle ||
              (isMultiField ? "Gesichertes Formular" : "Passwort / API-Key sicher eingeben")}
          </span>
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
        {isMultiField && fields ? (
          <>
            <p className="prompt-description">
              Alle Felder werden direkt und geschützt in der <code>.env</code> von {botLabel}{" "}
              gespeichert – niemals als Klartext im Chatverlauf.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {fields.map((field) => {
                const isVisible = Boolean(visibleKeys[field.keyName]);
                return (
                  <div key={field.keyName}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 8,
                        marginBottom: 4,
                        fontSize: "0.78rem",
                        color: "var(--text-secondary)",
                      }}
                    >
                      <span>{field.prompt || field.keyName}</span>
                      <code style={{ fontSize: "0.68rem", opacity: 0.72 }}>{field.keyName}</code>
                    </div>
                    <div className="secret-input-wrap">
                      <input
                        className="prompt-input"
                        type={isVisible ? "text" : "password"}
                        value={multiValues[field.keyName] || ""}
                        onChange={(e) =>
                          setMultiValues((prev) => ({
                            ...prev,
                            [field.keyName]: e.target.value,
                          }))
                        }
                        placeholder={`${field.prompt || field.keyName}…`}
                        autoComplete="off"
                        autoCapitalize="none"
                        spellCheck={false}
                        style={{ paddingRight: 42 }}
                        disabled={saving}
                      />
                      <button
                        type="button"
                        className="secret-eye-btn"
                        aria-label={isVisible ? "Verbergen" : "Anzeigen"}
                        onClick={() =>
                          setVisibleKeys((prev) => ({
                            ...prev,
                            [field.keyName]: !prev[field.keyName],
                          }))
                        }
                      >
                        {isVisible ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <>
            <p className="prompt-description">
              {promptText || (
                <>
                  Wird direkt im geschützten <code>.env</code>-Speicher von {botLabel} abgelegt und{" "}
                  {botLabel} erfährt direkt den Variablennamen – niemals den Klartext im Chat.
                </>
              )}
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
          </>
        )}

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
          disabled={
            saving ||
            (isMultiField ? !allMultiFilled : !keyName.trim() || !secretValue.trim())
          }
        >
          <Lock size={13} />{" "}
          {saving
            ? "Speichere…"
            : isMultiField
              ? "Formular sicher speichern & weiter"
              : "Sicher speichern & weiter"}
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

// ── 6. Native Encrypted Hermes Vault In-Chat Form (Payment / Address / Login) ─

interface VaultFormCardProps {
  profileName: string;
  botLabel: string;
  allPublicProfileNames?: string[];
  isPrivateBot?: boolean;
  request: DetectedVaultRequest;
  onSaved: (safeSummary: string, kind: DetectedVaultRequest["kind"]) => void;
  onClose: () => void;
}

export const VaultFormCard: React.FC<VaultFormCardProps> = ({
  profileName,
  botLabel,
  allPublicProfileNames = [],
  isPrivateBot = false,
  request,
  onSaved,
  onClose,
}) => {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncAllBots, setSyncAllBots] = useState(!isPrivateBot && allPublicProfileNames.length > 1);

  // Payment
  const [cardHolder, setCardHolder] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [expMonth, setExpMonth] = useState("");
  const [expYear, setExpYear] = useState("");
  const [cvc, setCvc] = useState("");
  const [billingZip, setBillingZip] = useState("");

  // Address
  const [addrLabel, setAddrLabel] = useState("Lieferadresse");
  const [addrLine1, setAddrLine1] = useState("");
  const [addrLine2, setAddrLine2] = useState("");
  const [addrZip, setAddrZip] = useState("");
  const [addrCity, setAddrCity] = useState("");
  const [addrCountry, setAddrCountry] = useState("Deutschland");

  // Login
  const [loginOrigin, setLoginOrigin] = useState(request.origin || "");
  const [loginIdentifier, setLoginIdentifier] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [showPass, setShowPass] = useState(false);

  const badgeTitle =
    request.kind === "payment"
      ? "Tresor · Zahlungskarte"
      : request.kind === "address"
        ? "Tresor · Lieferadresse"
        : "Tresor · Shop-Login";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    let payload: VaultAddPayload | null = null;
    if (request.kind === "payment") {
      const digits = cardNumber.replace(/\D+/g, "");
      if (digits.length < 12 || !expMonth.trim() || !expYear.trim() || !cvc.trim()) {
        setError("Bitte Kartennummer, Monat (MM), Jahr (JJJJ) und CVC eingeben.");
        return;
      }
      const normYear = expYear.trim().length === 2 ? `20${expYear.trim()}` : expYear.trim();
      payload = {
        kind: "payment",
        label: buildSafeCardLabel(digits),
        secret: {
          card_number: digits,
          ...(cardHolder.trim() ? { cardholder_name: cardHolder.trim() } : {}),
          exp_month: expMonth.trim().padStart(2, "0"),
          exp_year: normYear,
          cvc: cvc.trim(),
          ...(billingZip.trim() ? { billing_postal_code: billingZip.trim() } : {}),
        },
      };
    } else if (request.kind === "address") {
      if (!addrLine1.trim() || !addrZip.trim() || !addrCity.trim() || !addrCountry.trim()) {
        setError("Bitte Straße & Hausnummer, PLZ, Stadt und Land ausfüllen.");
        return;
      }
      payload = {
        kind: "address",
        label: addrLabel.trim() || "Lieferadresse",
        secret: {
          address_line1: addrLine1.trim(),
          ...(addrLine2.trim() ? { address_line2: addrLine2.trim() } : {}),
          postal_code: addrZip.trim(),
          city: addrCity.trim(),
          country: addrCountry.trim(),
        },
      };
    } else {
      const rawOrigin = loginOrigin.trim();
      if (!rawOrigin || !loginIdentifier.trim() || !loginPassword) {
        setError("Bitte Shop-Website, E-Mail/Benutzername und Passwort eingeben.");
        return;
      }
      const cleanOrigin = rawOrigin.startsWith("http") ? rawOrigin : `https://${rawOrigin}`;
      payload = {
        kind: "login",
        label: rawOrigin.replace(/^https?:\/\//i, "").replace(/\/.*$/, ""),
        origin: cleanOrigin,
        secret: {
          identifier_type: loginIdentifier.includes("@") ? "email" : "username",
          identifier: loginIdentifier.trim(),
          password: loginPassword,
        },
      };
    }

    setSaving(true);
    try {
      if (syncAllBots && !isPrivateBot && allPublicProfileNames.length > 0) {
        const targets = Array.from(new Set([profileName, "default", ...allPublicProfileNames]));
        await addVaultItemToProfiles(targets, payload);
      } else {
        await addVaultItem(profileName, payload);
      }
      setCardNumber("");
      setCvc("");
      setLoginPassword("");
      onSaved(payload.label, request.kind);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Konnte nicht im Tresor gespeichert werden.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="prompt-card secret" onSubmit={(e) => void handleSubmit(e)} autoComplete="off">
      <div className="prompt-card-header">
        <div className="prompt-card-badge secret">
          {request.kind === "payment" ? (
            <CreditCard size={14} />
          ) : request.kind === "address" ? (
            <MapPin size={14} />
          ) : (
            <KeyRound size={14} />
          )}
          <span>{badgeTitle}</span>
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
          {request.prompt} · Wird verschlüsselt im Hermes-Tresor abgelegt – {botLabel} füllt damit
          Bestellformulare direkt im Browser aus, ohne jemals Klartextdaten im Chat zu sehen.
        </p>

        {request.kind === "payment" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <input
              className="prompt-input"
              placeholder="Karteninhaber"
              value={cardHolder}
              onChange={(e) => setCardHolder(e.target.value)}
              disabled={saving}
            />
            <input
              className="prompt-input"
              inputMode="numeric"
              placeholder="Kartennummer"
              value={cardNumber}
              onChange={(e) => setCardNumber(e.target.value)}
              disabled={saving}
            />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              <input
                className="prompt-input"
                inputMode="numeric"
                placeholder="MM"
                maxLength={2}
                value={expMonth}
                onChange={(e) => setExpMonth(e.target.value)}
                disabled={saving}
              />
              <input
                className="prompt-input"
                inputMode="numeric"
                placeholder="JJJJ"
                maxLength={4}
                value={expYear}
                onChange={(e) => setExpYear(e.target.value)}
                disabled={saving}
              />
              <input
                className="prompt-input"
                type="password"
                inputMode="numeric"
                placeholder="CVC"
                maxLength={4}
                value={cvc}
                onChange={(e) => setCvc(e.target.value)}
                disabled={saving}
              />
            </div>
            <input
              className="prompt-input"
              inputMode="numeric"
              placeholder="Rechnungs-PLZ (optional)"
              value={billingZip}
              onChange={(e) => setBillingZip(e.target.value)}
              disabled={saving}
            />
          </div>
        )}

        {request.kind === "address" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <input
              className="prompt-input"
              placeholder="Bezeichnung (z. B. Zuhause)"
              value={addrLabel}
              onChange={(e) => setAddrLabel(e.target.value)}
              disabled={saving}
            />
            <input
              className="prompt-input"
              placeholder="Straße und Hausnummer"
              value={addrLine1}
              onChange={(e) => setAddrLine1(e.target.value)}
              disabled={saving}
            />
            <input
              className="prompt-input"
              placeholder="Adresszusatz (optional)"
              value={addrLine2}
              onChange={(e) => setAddrLine2(e.target.value)}
              disabled={saving}
            />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 8 }}>
              <input
                className="prompt-input"
                placeholder="PLZ"
                value={addrZip}
                onChange={(e) => setAddrZip(e.target.value)}
                disabled={saving}
              />
              <input
                className="prompt-input"
                placeholder="Stadt"
                value={addrCity}
                onChange={(e) => setAddrCity(e.target.value)}
                disabled={saving}
              />
            </div>
            <input
              className="prompt-input"
              placeholder="Land"
              value={addrCountry}
              onChange={(e) => setAddrCountry(e.target.value)}
              disabled={saving}
            />
          </div>
        )}

        {request.kind === "login" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <input
              className="prompt-input"
              placeholder="Shop-Website (z. B. https://www.mediamarkt.de)"
              value={loginOrigin}
              onChange={(e) => setLoginOrigin(e.target.value)}
              autoCapitalize="none"
              disabled={saving}
            />
            <input
              className="prompt-input"
              placeholder="E-Mail oder Benutzername"
              value={loginIdentifier}
              onChange={(e) => setLoginIdentifier(e.target.value)}
              autoCapitalize="none"
              disabled={saving}
            />
            <div className="secret-input-wrap">
              <input
                className="prompt-input"
                type={showPass ? "text" : "password"}
                placeholder="Passwort"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                style={{ paddingRight: 42 }}
                disabled={saving}
              />
              <button
                type="button"
                className="secret-eye-btn"
                aria-label={showPass ? "Verbergen" : "Anzeigen"}
                onClick={() => setShowPass((v) => !v)}
              >
                {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
        )}

        {!isPrivateBot && allPublicProfileNames.length > 1 && (
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginTop: 10,
              fontSize: "0.76rem",
              color: "var(--text-secondary)",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={syncAllBots}
              onChange={(e) => setSyncAllBots(e.target.checked)}
              disabled={saving}
            />
            <span>Auch für alle anderen Bots im Tresor speichern</span>
          </label>
        )}

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
        <button type="submit" className="btn sm primary" disabled={saving}>
          <Lock size={13} /> {saving ? "Speichere im Tresor…" : "Im Tresor speichern & weiter"}
        </button>
      </div>
    </form>
  );
};

// ── 7. Interactive Product Deal Card inside Chat Messages ────────────────────

interface ProductDealCardProps {
  deal: DetectedDealCard;
  disabled?: boolean;
  onBuy: (deal: DetectedDealCard) => void;
}

export const ProductDealCard: React.FC<ProductDealCardProps> = ({ deal, disabled, onBuy }) => {
  return (
    <div className="deal-card">
      <div className="deal-card-top">
        <span className="deal-card-shop">
          <ShoppingBag size={13} />
          <span>{deal.shop}</span>
        </span>
        {deal.url && (
          <a
            href={deal.url}
            target="_blank"
            rel="noopener noreferrer"
            className="deal-card-ext"
            aria-label={`Angebot bei ${deal.shop} öffnen`}
          >
            <ExternalLink size={13} />
          </a>
        )}
      </div>
      <div className="deal-card-title">{deal.title}</div>
      <div className="deal-card-prices">
        <span className="deal-card-price">{deal.price}</span>
        {deal.oldPrice && <span className="deal-card-old">{deal.oldPrice}</span>}
      </div>
      <button
        type="button"
        className="btn primary full deal-card-buy"
        disabled={disabled}
        onClick={() => onBuy(deal)}
      >
        Jetzt kaufen
      </button>
    </div>
  );
};
