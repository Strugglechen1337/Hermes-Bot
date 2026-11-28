import { ChevronLeft, Hand, Monitor } from "lucide-react";
import React, { useState } from "react";

interface BrowserDesktopViewProps {
  /** App-relative path of the proxied desktop, e.g. `/desk/9223/`. */
  path: string;
  botLabel: string;
  deskLabel?: string;
  avatar?: React.ReactNode;
  onClose: () => void;
}

/**
 * Full-screen live view of the browser a bot works in. Touches are blocked until the user taps
 * "Steuerung übernehmen", so scrolling the page never moves the bot's mouse by accident.
 * The desktop is served through the app's own session (no second password).
 */
export const BrowserDesktopView: React.FC<BrowserDesktopViewProps> = ({
  path,
  botLabel,
  deskLabel,
  avatar,
  onClose,
}) => {
  const [controlling, setControlling] = useState(false);
  const src = `${path}?autoconnect=1&resize=scale`;

  return (
    <div
      role="dialog"
      aria-label={`Browser von ${botLabel}`}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2000,
        background: "#000",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "calc(env(safe-area-inset-top, 0px) + 10px) 12px 10px",
          background: "var(--bg, #0b0b0f)",
          borderBottom: "1px solid var(--border, #222)",
        }}
      >
        <button type="button" className="glass-circle-btn" aria-label="Zurück" onClick={onClose}>
          <ChevronLeft size={20} />
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1 }}>
          {avatar}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {botLabel}
            </div>
            {deskLabel && (
              <div style={{ fontSize: "0.72rem", color: "var(--text-muted, #888)" }}>
                <Monitor size={11} style={{ verticalAlign: "-1px" }} /> {deskLabel}
              </div>
            )}
          </div>
        </div>
      </header>

      <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
        <iframe
          title={`Browser von ${botLabel}`}
          src={src}
          allow="clipboard-read; clipboard-write; fullscreen"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0, background: "#000" }}
        />
        {!controlling && (
          <div
            aria-hidden="true"
            style={{ position: "absolute", inset: 0, background: "transparent", touchAction: "none" }}
          />
        )}
        <button
          type="button"
          className="btn"
          onClick={() => setControlling((v) => !v)}
          style={{
            position: "absolute",
            right: 16,
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
