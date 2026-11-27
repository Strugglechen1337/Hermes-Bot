import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Check,
  FileText,
  RefreshCw,
  Search,
  Share2,
  Sparkles,
  X,
} from "lucide-react";
import type { HermesProfile } from "../../shared/types";
import { getBotVisual } from "../lib/botTheme";
import { formatRelativeTime } from "../lib/format";
import { fetchPocketPages, type PocketPageSummary } from "../lib/hermesApi";
import type { DetectedPocketPage } from "../lib/secretDetection";
import { BotAvatar } from "./BotAvatar";
import { PocketPageViewer } from "./InChatPromptCards";
import { Sheet } from "./Sheet";

interface PagesArchiveSheetProps {
  open: boolean;
  profiles: HermesProfile[];
  privateProfileNames: string[];
  avatars: Record<string, string>;
  onClose: () => void;
}

export const PagesArchiveSheet: React.FC<PagesArchiveSheetProps> = ({
  open,
  profiles,
  privateProfileNames,
  avatars,
  onClose,
}) => {
  const [pages, setPages] = useState<PocketPageSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [activePage, setActivePage] = useState<DetectedPocketPage | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const loadPages = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await fetchPocketPages();
      setPages(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Briefings konnten nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      void loadPages();
    }
  }, [loadPages, open]);

  const privateSet = useMemo(() => new Set(privateProfileNames), [privateProfileNames]);

  const visiblePages = useMemo(() => {
    const q = query.trim().toLowerCase();
    return pages
      .filter((p) => !p.bot || !privateSet.has(p.bot))
      .filter((p) => {
        if (!q) return true;
        return (
          p.title.toLowerCase().includes(q) ||
          p.summary.toLowerCase().includes(q) ||
          p.bot.toLowerCase().includes(q)
        );
      });
  }, [pages, privateSet, query]);

  return (
    <>
      <Sheet open={open} onClose={onClose}>
        <div className="sheet-header">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Sparkles size={18} style={{ color: "var(--accent-send)" }} />
            <h2 className="sheet-title">Briefings &amp; Seiten</h2>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <button
              type="button"
              className="icon-btn ghost"
              aria-label="Aktualisieren"
              disabled={loading}
              onClick={() => void loadPages()}
            >
              <RefreshCw size={16} />
            </button>
            <button
              type="button"
              className="icon-btn ghost"
              aria-label="Schließen"
              onClick={onClose}
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {pages.length > 4 && (
          <div className="search-wrap" style={{ marginBottom: 12 }}>
            <Search size={15} className="search-icon" />
            <input
              className="search-input"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Briefings durchsuchen…"
            />
          </div>
        )}

        {error && (
          <div className="notice err" style={{ marginBottom: 12 }}>
            <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>{error}</span>
          </div>
        )}

        {loading && pages.length === 0 ? (
          <div className="empty-state" style={{ padding: "24px 16px" }}>
            <p style={{ margin: 0 }}>Lade Briefings &amp; Seiten…</p>
          </div>
        ) : visiblePages.length === 0 ? (
          <div className="empty-state" style={{ padding: "26px 16px" }}>
            <FileText size={26} style={{ color: "var(--text-muted)" }} />
            <h3>Noch keine Seiten</h3>
            <p style={{ marginBottom: 0 }}>
              {query
                ? `Keine Seite passt zu „${query}“.`
                : "Sobald deine Bots Tagesbriefings, Morning Boards oder Übersichten erstellen, findest du sie hier gesammelt."}
            </p>
          </div>
        ) : (
          <div className="card-stack">
            {visiblePages.map((page) => {
              const prof = profiles.find((p) => p.name === page.bot);
              const vis = prof
                ? getBotVisual(prof)
                : page.bot
                  ? getBotVisual({
                      name: page.bot,
                      display_name: page.bot,
                      bot_title: "",
                      description: "",
                      model: null,
                    })
                  : null;
              const fullUrl =
                typeof window !== "undefined"
                  ? `${window.location.origin}/api/pocket/pages/${encodeURIComponent(page.id)}`
                  : `/api/pocket/pages/${encodeURIComponent(page.id)}`;
              return (
                <div key={page.id} className="archive-page-card">
                  <button
                    type="button"
                    className="archive-page-main"
                    onClick={() =>
                      setActivePage({
                        id: page.id,
                        title: page.title,
                        summary: page.summary,
                      })
                    }
                  >
                    {vis ? (
                      <BotAvatar visual={vis} imageUrl={avatars[page.bot]} size="sm" />
                    ) : (
                      <div
                        className="avatar sm"
                        style={{ background: "rgba(245, 158, 11, 0.2)", color: "var(--accent-send)" }}
                      >
                        <Sparkles size={15} />
                      </div>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="bot-card-row">
                        <span className="archive-page-title">{page.title}</span>
                        {page.createdAt > 0 && (
                          <span className="bot-list-time">
                            {formatRelativeTime(page.createdAt)}
                          </span>
                        )}
                      </div>
                      {page.summary && (
                        <div className="archive-page-summary">{page.summary}</div>
                      )}
                      {vis && (
                        <div className="archive-page-bot">{vis.label}</div>
                      )}
                    </div>
                  </button>
                  <button
                    type="button"
                    className="icon-btn ghost"
                    style={{ minWidth: 34, minHeight: 34, color: "var(--text-muted)" }}
                    aria-label={`„${page.title}“ teilen`}
                    title="Teilen"
                    onClick={() => {
                      const shareText = page.summary ? `${page.title}\n${page.summary}` : page.title;
                      if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
                        void navigator
                          .share({ title: page.title, text: shareText, url: fullUrl })
                          .catch(() => undefined);
                      } else {
                        void navigator.clipboard?.writeText(`${shareText}\n${fullUrl}`).then(() => {
                          setCopiedId(page.id);
                          window.setTimeout(() => setCopiedId((c) => (c === page.id ? null : c)), 1600);
                        });
                      }
                    }}
                  >
                    {copiedId === page.id ? <Check size={15} /> : <Share2 size={15} />}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </Sheet>

      <PocketPageViewer page={activePage} onClose={() => setActivePage(null)} />
    </>
  );
};
