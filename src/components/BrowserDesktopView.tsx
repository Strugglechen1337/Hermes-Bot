import { ChevronDown, ChevronLeft, ChevronUp, ClipboardPaste, Hand, Minus, Monitor, Plus, X } from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { insertBrowserText, scrollBrowser } from "../lib/hermesApi";

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

const DENSITY_KEY = "hermes-pocket.deskDensity";
const MIN_DENSITY = 1;
const MAX_DENSITY = 3;
const DENSITY_STEP = 0.25;

/** Portrait needs larger print than landscape, so the size is remembered per orientation. */
function loadDensity(landscape: boolean): number {
  try {
    const n = Number(localStorage.getItem(`${DENSITY_KEY}.${landscape ? "land" : "port"}`));
    if (Number.isFinite(n) && n >= MIN_DENSITY && n <= MAX_DENSITY) return n;
  } catch {
    // ignore
  }
  return landscape ? 1.5 : 1.25;
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

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/**
 * Full-screen live view of the browser a bot works in. Touches are blocked until the user taps
 * "Steuerung übernehmen", so scrolling the page never moves the bot's mouse by accident.
 * The remote screen gets (view size × density) pixels and is scaled to fit, so a higher density
 * shows more of the page in smaller print. Edges keep clear of the notch. The desktop is served
 * through the app's own session (no second password); "Einfügen" types text into the focused
 * field of the shown page and ▲/▼ scroll it.
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
  const [density, setDensity] = useState(() => loadDensity(landscape));
  useEffect(() => {
    setDensity(loadDensity(landscape));
  }, [landscape]);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);

  const applyResolution = useCallback(() => {
    const win = frameRef.current?.contentWindow;
    const box = boxRef.current;
    if (!win || !box) return;
    const rect = box.getBoundingClientRect();
    if (rect.width < 50 || rect.height < 50) return;
    const width = Math.min(4000, even(rect.width * density));
    const height = Math.min(4000, even(rect.height * density));
    win.postMessage({ type: "setScaleLocally", value: true }, window.location.origin);
    win.postMessage({ type: "setManualResolution", width, height }, window.location.origin);
  }, [density]);

  // Re-apply after load (the stream needs a moment), on size changes and on density changes.
  useEffect(() => {
    const timers = [1200, 3000, 6000].map((ms) => window.setTimeout(applyResolution, ms));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [applyResolution]);

  useEffect(() => {
    const box = boxRef.current;
    if (!box || typeof ResizeObserver === "undefined") return;
    let timer: number | undefined;
    const ro = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(applyResolution, 400);
    });
    ro.observe(box);
    return () => {
      window.clearTimeout(timer);
      ro.disconnect();
    };
  }, [applyResolution]);

  function changeDensity(delta: number) {
    // Bigger print = fewer remote pixels per view pixel.
    const next = Math.min(MAX_DENSITY, Math.max(MIN_DENSITY, Math.round((density + delta) * 100) / 100));
    setDensity(next);
    try {
      localStorage.setItem(`${DENSITY_KEY}.${landscape ? "land" : "port"}`, String(next));
    } catch {
      // ignore
    }
  }

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

  function scroll(direction: "up" | "down") {
    void scrollBrowser(id, direction).catch(() => undefined);
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
          gap: 8,
          padding: landscape
            ? "4px calc(env(safe-area-inset-right, 0px) + 12px) 4px calc(env(safe-area-inset-left, 0px) + 12px)"
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
        <button
          type="button"
          className="icon-btn ghost"
          aria-label="Größer darstellen"
          disabled={density <= MIN_DENSITY}
          onClick={() => changeDensity(-DENSITY_STEP)}
        >
          <Plus size={18} />
        </button>
        <button
          type="button"
          className="icon-btn ghost"
          aria-label="Kleiner darstellen"
          disabled={density >= MAX_DENSITY}
          onClick={() => changeDensity(DENSITY_STEP)}
        >
          <Minus size={18} />
        </button>
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

      <div
        ref={boxRef}
        style={{
          position: "relative",
          flex: 1,
          minHeight: 0,
          // Keep the stream clear of the notch / rounded corners so edge controls stay reachable.
          marginLeft: "env(safe-area-inset-left, 0px)",
          marginRight: "env(safe-area-inset-right, 0px)",
          marginBottom: "env(safe-area-inset-bottom, 0px)",
        }}
      >
        <iframe
          ref={frameRef}
          title={`Browser von ${botLabel}`}
          src={path}
          allow="clipboard-read; clipboard-write; fullscreen"
          onLoad={() => window.setTimeout(applyResolution, 800)}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0, background: "#000" }}
        />
        {!controlling && (
          <div aria-hidden="true" style={{ position: "absolute", inset: 0, background: "transparent", touchAction: "none" }} />
        )}
        <button
          type="button"
          className="btn"
          onClick={() => setControlling((v) => !v)}
          style={{ position: "absolute", left: 16, bottom: 18, zIndex: 2, borderRadius: 999 }}
        >
          <Hand size={16} /> {controlling ? "Steuerung abgeben" : "Steuerung übernehmen"}
        </button>
        <div
          style={{
            position: "absolute",
            right: 12,
            top: "50%",
            transform: "translateY(-50%)",
            zIndex: 2,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <button type="button" className="glass-circle-btn" aria-label="Seite hoch scrollen" onClick={() => scroll("up")}>
            <ChevronUp size={22} />
          </button>
          <button type="button" className="glass-circle-btn" aria-label="Seite runter scrollen" onClick={() => scroll("down")}>
            <ChevronDown size={22} />
          </button>
        </div>
      </div>
    </div>
  );
};
