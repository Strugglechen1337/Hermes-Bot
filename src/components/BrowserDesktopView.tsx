import { ChevronLeft, ClipboardPaste, Hand, Monitor, X } from "lucide-react";
import React, { useEffect, useState } from "react";
import { insertBrowserText } from "../lib/hermesApi";

interface BrowserDesktopViewProps {
  /** Desktop id (the CDP port the bots attach to), e.g. `9223`. */
  id: string;
  /** App-relative path of the proxied desktop, e.g. `/desk/9223/`. */
  path: string;
  botLabel: string;
  deskLabel?: string;
  avatar?: React.ReactNode;
  onClose: () => void;
}

function useLandscape(): boolean {
  const query = "(orientation: landscape)";
  const [landscape, setLandscape] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setLandscape(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return landscape;
}

/**
 * Full-screen live view of the browser a bot works in. Touches are blocked until the user taps
 * "Steuerung übernehmen", so scrolling the page never moves the bot's mouse by accident.
 * The remote screen resizes to this view (also after rotating to landscape). The desktop is
 * served through the app's own session (no second password); "Einfügen" types text into the
 * focused field of the shown page.
 */
export const BrowserDesktopView: React.FC<BrowserDesktopViewProps> = ({
  id,
  path,
  botLabel,
  deskLabel,
  avatar,
  onClose,
}) => {
  const landscape = useLandscape();
  const [controlling, setControlling] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasteBusy, setPasteBusy] = useState(false);
  const [pasteMsg, setPasteMsg] = useState<string | null>(null);
  const src = `${path}?autoconnect=1&resize=remote`;

  async function readClipboard() {
    try {
      setPasteText(await navigator.clipboard.readText());
      setPasteMsg(null);
    } catch {
      setPasteMsg("Zwischenablage nicht lesbar – Text bitte ins Feld einfügen (lange tippen → Einfügen).");
    }
  }

  async function sendText() {
    if (!pasteText || pasteBusy) return;
    setPasteBusy(true);
    setPasteMsg(null);
    try {
      await insertBrowserText(id, pasteText);
      setPasteText("");
      setPasteOpen(false);
    } catch {
      setPasteMsg("Konnte nicht eingefügt werden. Tippe zuerst im Browser in das Eingabefeld.");
    } finally {
      setPasteBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-label={`Browser von ${botLabel}`}
      style={{ position: "fixed", inset: 0, zIndex: 2000, background: "#000", display: "flex", flexDirection: "column" }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: landscape
            ? "4px 12px"
            : "calc(env(safe-area-inset-top, 0px) + 10px) 12px 10px",
          background: "var(--bg, #0b0b0f)",
          borderBottom: "1px solid var(--border, #222)",
        }}
      >
        <button type="button" className="glass-circle-btn" aria-label="Zurück" onClick={onClose}>
          <ChevronLeft size={20} />
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1 }}>
          {!landscape && avatar}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {botLabel}
            </div>
            {deskLabel && !landscape && (
              <div style={{ fontSize: "0.72rem", color: "var(--text-muted, #888)" }}>
                <Monitor size={11} style={{ verticalAlign: "-1px" }} /> {deskLabel}
              </div>
            )}
          </div>
        </div>
        <button type="button" className="btn" onClick={() => setPasteOpen((v) => !v)}>
          <ClipboardPaste size={16} /> Einfügen
        </button>
      </header>

      {pasteOpen && (
        <div style={{ padding: 10, background: "var(--bg, #0b0b0f)", borderBottom: "1px solid var(--border, #222)" }}>
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder="Text hier einfügen – er wird in das markierte Feld im Browser geschrieben"
            rows={3}
            style={{ width: "100%", boxSizing: "border-box", fontSize: 16 }}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
            <button type="button" className="btn" onClick={() => void readClipboard()}>
              Aus Zwischenablage
            </button>
            <button type="button" className="btn primary" disabled={!pasteText || pasteBusy} onClick={() => void sendText()}>
              {pasteBusy ? "Sende…" : "In Browser schreiben"}
            </button>
            <button type="button" className="icon-btn ghost" aria-label="Schließen" onClick={() => setPasteOpen(false)}>
              <X size={18} />
            </button>
          </div>
          {pasteMsg && <p style={{ fontSize: "0.78rem", color: "var(--text-muted, #888)", margin: "6px 0 0" }}>{pasteMsg}</p>}
        </div>
      )}

      <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
        <iframe
          title={`Browser von ${botLabel}`}
          src={src}
          allow="clipboard-read; clipboard-write; fullscreen"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0, background: "#000" }}
        />
        {!controlling && (
          <div aria-hidden="true" style={{ position: "absolute", inset: 0, background: "transparent", touchAction: "none" }} />
        )}
        <button
          type="button"
          className="btn"
          onClick={() => setControlling((v) => !v)}
          style={{
            position: "absolute",
            left: 16,
            bottom: "calc(env(safe-area-inset-bottom, 0px) + 18px)",
            zIndex: 2,
            borderRadius: 999,
          }}
        >
          <Hand size={16} /> {controlling ? "Steuerung abgeben" : "Steuerung übernehmen"}
        </button>
      </div>
    </div>
  );
};
