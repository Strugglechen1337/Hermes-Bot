import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Copy, Download, FileText, Image as ImageIcon, RefreshCw, Share2, Volume2, X } from "lucide-react";
import { fetchProfileMediaGallery, type ProfileMediaGalleryItem } from "../lib/hermesApi";
import { copyImageToClipboard, shareOrSaveLocalMedia } from "./SafeMarkdown";
import { Sheet } from "./Sheet";

interface BotMediaGallerySheetProps {
  open: boolean;
  profileName: string;
  botLabel: string;
  onClose: () => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const BotMediaGallerySheet: React.FC<BotMediaGallerySheetProps> = ({
  open,
  profileName,
  botLabel,
  onClose,
}) => {
  const [items, setItems] = useState<ProfileMediaGalleryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "images" | "files">("all");
  const [lightboxItem, setLightboxItem] = useState<ProfileMediaGalleryItem | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await fetchProfileMediaGallery(profileName);
      setItems(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Medien konnten nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      setFilter("all");
      void load();
    }
  }, [open, profileName]);

  const images = useMemo(() => items.filter((i) => i.kind === "image"), [items]);
  const otherFiles = useMemo(() => items.filter((i) => i.kind !== "image"), [items]);

  const visibleImages = filter === "files" ? [] : images;
  const visibleFiles = filter === "images" ? [] : otherFiles;

  return (
    <>
      <Sheet open={open} onClose={onClose}>
        <div className="sheet-header">
          <h2 className="sheet-title">Medien · {botLabel}</h2>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              className="icon-btn ghost"
              aria-label="Aktualisieren"
              disabled={loading}
              onClick={() => void load()}
            >
              <RefreshCw size={17} />
            </button>
            <button type="button" className="icon-btn ghost" aria-label="Schließen" onClick={onClose}>
              <X size={20} />
            </button>
          </div>
        </div>

        {items.length > 0 && (
          <div className="media-gallery-tabs">
            <button
              type="button"
              className={`btn sm ${filter === "all" ? "primary" : ""}`}
              onClick={() => setFilter("all")}
            >
              Alle ({items.length})
            </button>
            <button
              type="button"
              className={`btn sm ${filter === "images" ? "primary" : ""}`}
              onClick={() => setFilter("images")}
            >
              Bilder ({images.length})
            </button>
            <button
              type="button"
              className={`btn sm ${filter === "files" ? "primary" : ""}`}
              onClick={() => setFilter("files")}
            >
              Dateien ({otherFiles.length})
            </button>
          </div>
        )}

        {error && <div className="notice err" style={{ marginBottom: 12 }}>{error}</div>}

        {loading && items.length === 0 ? (
          <div className="empty-state" style={{ padding: "28px 12px" }}>
            Lade Medien…
          </div>
        ) : items.length === 0 ? (
          <div className="empty-state" style={{ padding: "28px 12px" }}>
            <ImageIcon size={24} style={{ opacity: 0.45, marginBottom: 8 }} />
            <div>Noch keine erstellten Bilder oder Dateien von {botLabel}.</div>
          </div>
        ) : (
          <div className="media-gallery-body">
            {visibleImages.length > 0 && (
              <div className="media-gallery-grid" aria-label="Bilder-Galerie">
                {visibleImages.map((item) => (
                  <button
                    key={item.path}
                    type="button"
                    className="media-gallery-tile"
                    aria-label={item.filename}
                    onClick={() => {
                      setCopied(false);
                      setLightboxItem(item);
                    }}
                  >
                    <img src={item.src} alt={item.filename} loading="lazy" />
                  </button>
                ))}
              </div>
            )}

            {visibleFiles.length > 0 && (
              <div className="media-gallery-files">
                {visibleFiles.map((item) => (
                  <button
                    key={item.path}
                    type="button"
                    className="md-media-file-card"
                    disabled={actionBusy}
                    onClick={async () => {
                      setActionBusy(true);
                      try {
                        await shareOrSaveLocalMedia(item.src, item.filename);
                      } catch {
                        // ignore
                      } finally {
                        setActionBusy(false);
                      }
                    }}
                  >
                    {item.kind === "audio" ? <Volume2 size={18} /> : <FileText size={18} />}
                    <div className="md-media-file-info">
                      <span className="md-media-file-name">{item.filename}</span>
                      <span className="md-media-file-sub">{formatFileSize(item.size)}</span>
                    </div>
                    <Download size={16} />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </Sheet>

      {lightboxItem &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="image-lightbox-backdrop"
            role="dialog"
            aria-modal="true"
            aria-label={lightboxItem.filename}
            onClick={() => setLightboxItem(null)}
          >
            <div className="image-lightbox-content" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                className="icon-btn image-lightbox-close"
                aria-label="Schließen"
                onClick={() => setLightboxItem(null)}
              >
                <X size={20} />
              </button>
              <img
                src={lightboxItem.src}
                alt={lightboxItem.filename}
                className="image-lightbox-img"
              />
              <div className="image-lightbox-footer">
                <span className="image-lightbox-caption">{lightboxItem.filename}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <button
                    type="button"
                    className="btn sm"
                    onClick={async () => {
                      const ok = await copyImageToClipboard(lightboxItem.src);
                      if (ok) {
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1800);
                      }
                    }}
                  >
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                    {copied ? "Kopiert" : "Kopieren"}
                  </button>
                  <button
                    type="button"
                    className="btn sm primary"
                    disabled={actionBusy}
                    onClick={async () => {
                      if (actionBusy) return;
                      setActionBusy(true);
                      try {
                        await shareOrSaveLocalMedia(lightboxItem.src, lightboxItem.filename);
                      } catch {
                        // ignore
                      } finally {
                        setActionBusy(false);
                      }
                    }}
                  >
                    <Share2 size={14} /> {actionBusy ? "Lädt…" : "Teilen / Sichern"}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
};
