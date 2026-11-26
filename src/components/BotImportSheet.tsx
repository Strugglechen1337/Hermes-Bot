import React, { useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Camera,
  Check,
  Copy,
  Download,
  FileUp,
  Info,
  Sparkles,
  X,
} from "lucide-react";
import { prepareAvatarDataUrl, saveBotAvatar } from "../lib/avatarStore";
import {
  buildHermesSoulDocument,
  GROKBOT_EXPORT_PROMPT,
  parseBotImportText,
  slugifyBotName,
} from "../lib/botImportParser";
import { getBotVisual } from "../lib/botTheme";
import { createProfile } from "../lib/hermesApi";
import type { WsConnectionState } from "../lib/hermesWs";
import { BotAvatar } from "./BotAvatar";
import { Sheet } from "./Sheet";

interface BotImportSheetProps {
  open: boolean;
  wsState: WsConnectionState;
  onClose: () => void;
  onImported: (profileName: string, avatarDataUrl: string | null) => Promise<void> | void;
}

export const BotImportSheet: React.FC<BotImportSheetProps> = ({
  open,
  wsState,
  onClose,
  onImported,
}) => {
  const [rawExport, setRawExport] = useState("");
  const [nameOverride, setNameOverride] = useState("");
  const [descOverride, setDescOverride] = useState("");
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const parsed = useMemo(() => parseBotImportText(rawExport), [rawExport]);
  const effectiveName = nameOverride.trim() || parsed?.name || "";
  const effectiveSlug = slugifyBotName(effectiveName);
  const effectiveDesc = descOverride.trim() || parsed?.description || "";

  async function handleCopyPrompt() {
    try {
      await navigator.clipboard.writeText(GROKBOT_EXPORT_PROMPT);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      setError("Konnte nicht automatisch kopieren – bitte Text manuell markieren.");
    }
  }

  async function handlePickAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      setAvatarPreview(await prepareAvatarDataUrl(file, 320));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bild konnte nicht gelesen werden.");
    }
  }

  async function handlePickExportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      setRawExport(text);
      setError(null);
    } catch {
      setError("Export-Datei konnte nicht gelesen werden.");
    }
  }

  async function handleImport(e: React.FormEvent) {
    e.preventDefault();
    if (!parsed) {
      setError("Bitte zuerst die Export-Antwort deines Grok-Bots einfügen.");
      return;
    }
    if (!effectiveSlug) {
      setError("Bitte einen gültigen Bot-Namen (Buchstaben/Zahlen) angeben.");
      return;
    }

    setImporting(true);
    setError(null);
    try {
      const finalDoc = buildHermesSoulDocument({
        ...parsed,
        name: effectiveName || parsed.name,
        slug: effectiveSlug,
        description: effectiveDesc,
      });

      const created = await createProfile({
        name: effectiveSlug,
        description: effectiveDesc || undefined,
        soul: finalDoc,
        mirror_credentials: true,
        share_auth: true,
      });

      const finalName = created?.name || effectiveSlug;
      if (avatarPreview && wsState === "connected") {
        await saveBotAvatar(finalName, avatarPreview).catch(() => null);
      }

      setRawExport("");
      setNameOverride("");
      setDescOverride("");
      const savedAvatar = avatarPreview;
      setAvatarPreview(null);
      await onImported(finalName, savedAvatar);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bot-Import fehlgeschlagen.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={() => {
        if (!importing) onClose();
      }}
    >
      <div className="sheet-header">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Sparkles size={18} style={{ color: "var(--accent-send)" }} />
          <h2 className="sheet-title">Grok-Bot in Hermes importieren</h2>
        </div>
        <button
          type="button"
          className="icon-btn ghost"
          aria-label="Schließen"
          disabled={importing}
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>

      {/* Step 1: Copy export prompt */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 700, fontSize: "0.88rem", marginBottom: 6 }}>
          1. Export-Prompt in Grok Bot einfügen
        </div>
        <p style={{ margin: "0 0 10px", fontSize: "0.8rem", color: "var(--text-secondary)", lineHeight: 1.45 }}>
          Kopiere diesen Prompt, schicke ihn an deinen Grok Bot und kopiere seine Antwort zurück
          hierher. Zugangsdaten bleiben außen vor.
        </p>
        <button
          type="button"
          className={`btn sm full ${copied ? "" : "primary"}`}
          onClick={() => void handleCopyPrompt()}
        >
          {copied ? <Check size={15} /> : <Copy size={15} />}
          {copied ? "Export-Prompt kopiert!" : "Export-Prompt kopieren"}
        </button>
      </div>

      {/* Step 2: Paste reply or load file */}
      <form onSubmit={handleImport}>
        <div className="field">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <label htmlFor="bot-import-raw">2. Antwort aus Grok Bot einfügen</label>
            <button
              type="button"
              className="btn sm"
              style={{ minHeight: 30, padding: "0 10px", fontSize: "0.75rem" }}
              onClick={() => fileInputRef.current?.click()}
            >
              <FileUp size={13} /> Datei laden
            </button>
          </div>
          <textarea
            id="bot-import-raw"
            className="textarea"
            style={{ minHeight: 120 }}
            value={rawExport}
            onChange={(e) => setRawExport(e.target.value)}
            placeholder="JSON- oder Text-Antwort des Grok Bots hier einfügen…"
          />
        </div>

        {parsed && (
          <div className="card" style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
              <button
                type="button"
                className="avatar-edit-btn"
                onClick={() => avatarInputRef.current?.click()}
              >
                <BotAvatar
                  visual={getBotVisual({
                    name: effectiveName || "bot",
                    display_name: effectiveName,
                    bot_title: "",
                    description: "",
                    model: null,
                  })}
                  imageUrl={avatarPreview}
                />
                <span className="avatar-camera-badge">
                  <Camera size={11} />
                </span>
              </button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: "0.94rem" }}>
                  Vorschau ({parsed.format === "json" ? "JSON erkannt" : "Text erkannt"})
                </div>
                <div style={{ fontSize: "0.76rem", color: "var(--text-secondary)", marginTop: 2 }}>
                  Profil: <code>{effectiveSlug || "—"}</code> · {parsed.memories.length} Erinnerungen
                  {parsed.routines.length > 0 ? ` · ${parsed.routines.length} Routinen-Entwürfe` : ""}
                </div>
              </div>
            </div>

            <div className="field">
              <label htmlFor="imp-name">Bot-Name</label>
              <input
                id="imp-name"
                className="input"
                value={nameOverride || parsed.name}
                onChange={(e) => setNameOverride(e.target.value)}
              />
            </div>

            <div className="field" style={{ marginBottom: 8 }}>
              <label htmlFor="imp-desc">Kurzbeschreibung</label>
              <input
                id="imp-desc"
                className="input"
                value={descOverride || parsed.description}
                onChange={(e) => setDescOverride(e.target.value)}
                placeholder="Rolle des Bots"
              />
            </div>

            {parsed.integrations.length > 0 && (
              <div className="notice" style={{ marginTop: 10, padding: "8px 10px" }}>
                <Info size={15} style={{ flexShrink: 0, marginTop: 2 }} />
                <span>
                  Benötigte Connectoren ({parsed.integrations.join(", ")}) verbindest du nach dem
                  Import direkt in Hermes oder im Chat.
                </span>
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="notice err" style={{ marginBottom: 12 }}>
            <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>{error}</span>
          </div>
        )}

        <button
          type="submit"
          className="btn primary full"
          disabled={importing || !parsed || !effectiveSlug}
        >
          <Download size={16} />
          {importing ? "Importiere in Hermes…" : "Als Hermes-Bot anlegen"}
        </button>
      </form>

      <input
        ref={avatarInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => void handlePickAvatar(e)}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,.txt,.md,application/json,text/plain,text/markdown"
        style={{ display: "none" }}
        onChange={(e) => void handlePickExportFile(e)}
      />
    </Sheet>
  );
};
