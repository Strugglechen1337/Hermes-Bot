import React, { useState } from "react";
import { AlertCircle, Check, Cpu, KeyRound, ShieldCheck, X } from "lucide-react";
import { savePocketSecret } from "../lib/hermesApi";
import { Sheet } from "./Sheet";

export interface AiProviderPreset {
  id: string;
  name: string;
  envKey: string;
  modelsHint: string;
  placeholder: string;
  isUrl?: boolean;
}

export const TOP_AI_PROVIDERS: AiProviderPreset[] = [
  {
    id: "openai",
    name: "OpenAI",
    envKey: "OPENAI_API_KEY",
    modelsHint: "GPT-5, GPT-4.1, o3, o4-mini",
    placeholder: "sk-proj-…",
  },
  {
    id: "anthropic",
    name: "Anthropic Claude",
    envKey: "ANTHROPIC_API_KEY",
    modelsHint: "Claude Sonnet 4.5 / Opus 4",
    placeholder: "sk-ant-…",
  },
  {
    id: "gemini",
    name: "Google Gemini",
    envKey: "GEMINI_API_KEY",
    modelsHint: "Gemini 2.5 Pro / Flash",
    placeholder: "AIza…",
  },
  {
    id: "xai",
    name: "xAI Grok",
    envKey: "XAI_API_KEY",
    modelsHint: "Grok 4, Grok 3, Grok Vision",
    placeholder: "xai-…",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    envKey: "OPENROUTER_API_KEY",
    modelsHint: "200+ Modelle über einen API-Key",
    placeholder: "sk-or-v1-…",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    envKey: "DEEPSEEK_API_KEY",
    modelsHint: "DeepSeek R1, DeepSeek V3",
    placeholder: "sk-…",
  },
  {
    id: "mistral",
    name: "Mistral AI",
    envKey: "MISTRAL_API_KEY",
    modelsHint: "Mistral Large, Codestral",
    placeholder: "API-Key…",
  },
  {
    id: "groq",
    name: "Groq",
    envKey: "GROQ_API_KEY",
    modelsHint: "Ultra-schnelle Llama 4 & Qwen",
    placeholder: "gsk_…",
  },
  {
    id: "ollama",
    name: "Ollama (Lokal)",
    envKey: "OLLAMA_BASE_URL",
    modelsHint: "100 % lokal auf deinem Server",
    placeholder: "http://127.0.0.1:11434",
    isUrl: true,
  },
];

interface AiProvidersSheetProps {
  open: boolean;
  onClose: () => void;
}

export const AiProvidersSheet: React.FC<AiProvidersSheetProps> = ({ open, onClose }) => {
  const [selected, setSelected] = useState<AiProviderPreset | null>(null);
  const [secretValue, setSecretValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || !secretValue.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await savePocketSecret(selected.envKey, secretValue.trim());
      setSavedIds((prev) => Array.from(new Set([...prev, selected.id])));
      setSecretValue("");
      setSelected(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Konnte nicht gespeichert werden.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose}>
      <div className="sheet-header">
        <h2 className="sheet-title">KI-Anbieter verbinden</h2>
        <button type="button" className="icon-btn ghost" aria-label="Schließen" onClick={onClose}>
          <X size={20} />
        </button>
      </div>

      <p style={{ margin: "0 0 12px", fontSize: "0.84rem", color: "var(--text-secondary)", lineHeight: 1.45 }}>
        Hinterlege API-Keys der meistgenutzten KI-Anbieter direkt in deinem privaten Hermes-Server
        (Write-Only – Keys werden niemals im Browser gespeichert oder zurückgelesen). Danach kannst du
        die Modelle bei jedem Bot frei auswählen.
      </p>

      {error && (
        <div className="notice err" style={{ marginBottom: 10 }}>
          <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>{error}</span>
        </div>
      )}

      {selected ? (
        <form onSubmit={handleSave} className="card" style={{ padding: 14 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <strong>{selected.name}</strong>
            <span className="pill" style={{ fontSize: "0.72rem" }}>{selected.envKey}</span>
          </div>
          <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: 10 }}>
            {selected.modelsHint}
          </div>
          <div className="field">
            <label htmlFor="ai-prov-val">{selected.isUrl ? "Server-URL" : "API-Key"}</label>
            <input
              id="ai-prov-val"
              type={selected.isUrl ? "url" : "password"}
              className="input"
              autoComplete="off"
              value={secretValue}
              onChange={(e) => setSecretValue(e.target.value)}
              placeholder={selected.placeholder}
            />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              className="btn"
              style={{ flex: 1 }}
              disabled={saving}
              onClick={() => {
                setSelected(null);
                setSecretValue("");
                setError(null);
              }}
            >
              Zurück
            </button>
            <button
              type="submit"
              className="btn primary"
              style={{ flex: 2 }}
              disabled={saving || !secretValue.trim()}
            >
              <ShieldCheck size={15} /> {saving ? "Speichere…" : "Sicher speichern"}
            </button>
          </div>
        </form>
      ) : (
        <div className="card-stack" style={{ maxHeight: "58vh", overflowY: "auto" }}>
          {TOP_AI_PROVIDERS.map((prov) => {
            const isSaved = savedIds.includes(prov.id);
            return (
              <button
                key={prov.id}
                type="button"
                className="card provider-preset-row"
                onClick={() => {
                  setSelected(prov);
                  setSecretValue("");
                  setError(null);
                }}
              >
                <div className="provider-preset-main">
                  <div className="provider-preset-title">
                    <Cpu size={14} style={{ color: "var(--accent)" }} />
                    <span>{prov.name}</span>
                  </div>
                  <div className="provider-preset-sub">{prov.modelsHint}</div>
                </div>
                <span className={`pill ${isSaved ? "ok" : ""}`} style={{ fontSize: "0.72rem" }}>
                  {isSaved ? (
                    <>
                      <Check size={12} /> Gespeichert
                    </>
                  ) : (
                    <>
                      <KeyRound size={12} /> Verbinden
                    </>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </Sheet>
  );
};
