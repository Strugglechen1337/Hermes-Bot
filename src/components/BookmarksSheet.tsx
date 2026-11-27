import React, { useEffect, useMemo, useState } from "react";
import { Bookmark, Check, Copy, ExternalLink, Search, Trash2, Volume2, X } from "lucide-react";
import { deleteBookmark, fetchBookmarks, type SavedBookmark } from "../lib/hermesApi";
import { formatRelativeTime } from "../lib/format";
import { stopSpeaking, subscribeTtsState, toggleSpeakText, isTtsSupported } from "../lib/tts";
import { Sheet } from "./Sheet";

interface BookmarksSheetProps {
  open: boolean;
  onClose: () => void;
  onOpenBot: (botName: string) => void;
}

export const BookmarksSheet: React.FC<BookmarksSheetProps> = ({ open, onClose, onOpenBot }) => {
  const [items, setItems] = useState<SavedBookmark[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [speakingId, setSpeakingId] = useState<string | null>(null);

  useEffect(() => {
    return subscribeTtsState(setSpeakingId);
  }, []);

  useEffect(() => {
    if (!open) {
      stopSpeaking();
      return;
    }
    setLoading(true);
    void fetchBookmarks()
      .then(setItems)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (b) =>
        b.text.toLowerCase().includes(q) ||
        b.author.toLowerCase().includes(q) ||
        b.bot.toLowerCase().includes(q)
    );
  }, [items, query]);

  const handleRemove = async (id: string) => {
    setItems((prev) => prev.filter((b) => b.id !== id));
    await deleteBookmark(id).catch(() => {});
  };

  return (
    <Sheet open={open} onClose={onClose}>
      <div className="sheet-header">
        <h2 className="sheet-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Bookmark size={18} />
          Gemerkte Nachrichten
        </h2>
        <button
          type="button"
          className="icon-btn ghost"
          aria-label="Schließen"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>

      {items.length > 0 && (
        <div className="search-field" style={{ marginBottom: 12 }}>
          <Search size={15} />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Gemerkte Nachrichten durchsuchen…"
          />
        </div>
      )}

      {loading ? (
        <div className="empty-state" style={{ padding: "28px 12px" }}>
          <div className="spinner" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state" style={{ padding: "28px 12px" }}>
          <Bookmark size={28} style={{ opacity: 0.4, marginBottom: 8 }} />
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            {items.length === 0 ? "Noch nichts gemerkt" : "Keine Treffer"}
          </div>
          <div style={{ fontSize: "0.84rem", color: "var(--text-secondary)" }}>
            Halte im Chat einfach eine Nachricht gedrückt und tippe auf „Merken“, um wichtige
            Antworten hier schnell wiederzufinden.
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {filtered.map((item) => (
            <div key={item.id} className="card" style={{ padding: 12 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  marginBottom: 6,
                }}
              >
                <span style={{ fontWeight: 600, fontSize: "0.86rem" }}>{item.author}</span>
                <span style={{ fontSize: "0.75rem", color: "var(--text-tertiary)" }}>
                  {formatRelativeTime(item.createdAt)}
                </span>
              </div>
              <div
                style={{
                  fontSize: "0.86rem",
                  color: "var(--text-secondary)",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  maxHeight: 160,
                  overflowY: "auto",
                  marginBottom: 10,
                }}
              >
                {item.text}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                {item.bot && (
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() => {
                      onClose();
                      onOpenBot(item.bot);
                    }}
                  >
                    <ExternalLink size={13} /> Zum Bot
                  </button>
                )}
                {isTtsSupported() && (
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() => toggleSpeakText(`bm-${item.id}`, item.text)}
                  >
                    <Volume2 size={13} /> {speakingId === `bm-${item.id}` ? "Stopp" : "Vorlesen"}
                  </button>
                )}
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => {
                    void navigator.clipboard?.writeText(item.text);
                    setCopiedId(item.id);
                    setTimeout(() => setCopiedId(null), 1500);
                  }}
                >
                  {copiedId === item.id ? <Check size={13} /> : <Copy size={13} />}
                  {copiedId === item.id ? "Kopiert" : "Kopieren"}
                </button>
                <button
                  type="button"
                  className="btn sm"
                  style={{ marginLeft: "auto", color: "var(--danger, #f87171)" }}
                  aria-label="Lesezeichen entfernen"
                  onClick={() => void handleRemove(item.id)}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Sheet>
  );
};
