import React, { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Copy, Download, ExternalLink, FileText, Image as ImageIcon, Share2, Volume2, X } from "lucide-react";

interface SafeMarkdownProps {
  text: string;
}

export interface ExtractedWebImage {
  src: string;
  alt: string;
  href?: string;
  host: string;
  isLocalMedia?: boolean;
  downloadUrl?: string;
}

export interface ExtractedLocalMedia {
  path: string;
  src: string;
  downloadUrl: string;
  filename: string;
  alt: string;
  kind: "image" | "audio" | "video" | "file";
}

const IMAGE_EXT_RE = /\.(?:jpe?g|png|webp|gif|avif)(?:[?#][^\s<>()]*)?$/i;
const AUDIO_EXT_RE = /\.(?:mp3|wav|ogg|opus|m4a|aac)$/i;
const VIDEO_EXT_RE = /\.(?:mp4|webm|mov)$/i;

function classifyMediaKind(filePath: string): ExtractedLocalMedia["kind"] {
  if (IMAGE_EXT_RE.test(filePath)) return "image";
  if (AUDIO_EXT_RE.test(filePath)) return "audio";
  if (VIDEO_EXT_RE.test(filePath)) return "video";
  return "file";
}

function getBasename(filePath: string): string {
  const parts = filePath.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || "Datei";
}

/**
 * Extracts Hermes native `MEDIA:/abs/path/to/file.ext` attachments (and local
 * markdown images pointing to `MEDIA:/...` or `/.hermes/...`) so generated
 * images, audio, video and files render directly inline inside the chat bubble
 * instead of showing raw server file paths.
 */
export function extractLocalMediaAttachments(text: string): {
  cleanedText: string;
  media: ExtractedLocalMedia[];
} {
  if (!text) return { cleanedText: "", media: [] };

  const media: ExtractedLocalMedia[] = [];
  const seen = new Set<string>();

  const pushMedia = (rawPath: string, altRaw?: string) => {
    const cleaned = rawPath.trim().replace(/[),.;:!?]+$/, "");
    if (!cleaned.startsWith("/") || cleaned.includes("..")) return;
    if (seen.has(cleaned) || media.length >= 12) return;
    seen.add(cleaned);
    const filename = getBasename(cleaned);
    const encoded = encodeURIComponent(cleaned);
    media.push({
      path: cleaned,
      src: `/api/pocket/media?path=${encoded}`,
      downloadUrl: `/api/pocket/media?path=${encoded}&download=1`,
      filename,
      alt: altRaw?.trim() || filename,
      kind: classifyMediaKind(cleaned),
    });
  };

  const segments = text.split(/(```[\s\S]*?```)/g);
  const cleanedSegments = segments.map((seg) => {
    if (seg.startsWith("```") && seg.endsWith("```")) return seg;

    // 1. Markdown image referencing MEDIA:/... or local /.hermes/... path
    let out = seg.replace(
      /!\[([^\]]*)\]\((?:MEDIA:\s*)?(\/[^\s)]+)\)/gi,
      (_m, alt: string, filePath: string) => {
        pushMedia(filePath, alt);
        return "";
      }
    );

    // 2. Native Hermes MEDIA:/path/to/file.ext (optionally backtick-wrapped)
    out = out.replace(
      /`?MEDIA:\s*(\/[^\s`<>()[\]"']+)`?/gi,
      (_m, filePath: string) => {
        pushMedia(filePath);
        return "";
      }
    );

    out = out
      .replace(/^\s*[-*•]\s*$/gm, "")
      .replace(/\n{3,}/g, "\n\n");

    return out;
  });

  return {
    cleanedText: cleanedSegments.join("").trim(),
    media,
  };
}

function isSafeHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function getHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

function stripTrailingPunctuation(url: string): { url: string; trailing: string } {
  const m = url.match(/^(.*?)([.,;:!?)\]]+)?$/);
  if (!m) return { url, trailing: "" };
  return { url: m[1] || url, trailing: m[2] || "" };
}

/**
 * Extracts safe `http(s)` images from Markdown (`![alt](url)`, `[![alt](img)](href)`)
 * and direct image URLs outside fenced code blocks so web searches render as a
 * horizontal swipeable image carousel right in chat.
 */
export function extractWebSearchImages(text: string): {
  cleanedText: string;
  images: ExtractedWebImage[];
} {
  if (!text) return { cleanedText: "", images: [] };

  const images: ExtractedWebImage[] = [];
  const seen = new Set<string>();

  const pushImage = (srcRaw: string, altRaw: string, hrefRaw?: string) => {
    const src = srcRaw.trim();
    if (!isSafeHttpUrl(src) || seen.has(src) || images.length >= 16) return;
    const href = hrefRaw && isSafeHttpUrl(hrefRaw) ? hrefRaw.trim() : undefined;
    seen.add(src);
    const host = getHostname(href || src);
    images.push({
      src,
      alt: altRaw.trim() || host || "Bild",
      ...(href ? { href } : {}),
      host,
    });
  };

  // Preserve fenced code blocks untouched
  const segments = text.split(/(```[\s\S]*?```)/g);
  const cleanedSegments = segments.map((seg) => {
    if (seg.startsWith("```") && seg.endsWith("```")) return seg;

    // 1. Linked markdown image: [![alt](imgUrl)](linkUrl)
    let out = seg.replace(
      /\[!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)\]\((https?:\/\/[^\s)]+)\)/g,
      (_m, alt: string, imgUrl: string, linkUrl: string) => {
        pushImage(imgUrl, alt, linkUrl);
        return "";
      }
    );

    // 2. Standard markdown image: ![alt](imgUrl)
    out = out.replace(
      /!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g,
      (_m, alt: string, imgUrl: string) => {
        pushImage(imgUrl, alt);
        return "";
      }
    );

    // 3. Bare direct image URLs on their own or inline (skip if already inside markdown link `(url)`)
    out = out.replace(
      /(^|[\s(])(https?:\/\/[^\s<>()]+?\.(?:jpe?g|png|webp|gif|avif)(?:\?[^\s<>()]*)?)/gi,
      (full, prefix: string, rawUrl: string) => {
        if (prefix === "(") return full;
        const { url, trailing } = stripTrailingPunctuation(rawUrl);
        if (!isSafeHttpUrl(url)) return full;
        pushImage(url, "");
        return trailing ? `${prefix}${trailing}` : prefix;
      }
    );

    // Collapse empty bullet lines left behind after extracting standalone images
    out = out
      .replace(/^\s*[-*•]\s*$/gm, "")
      .replace(/\n{3,}/g, "\n\n");

    return out;
  });

  return {
    cleanedText: cleanedSegments.join("").trim(),
    images,
  };
}

function renderInline(line: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // Matches inline code, markdown links [text](https://...), bold, italic, or bare http(s) URLs
  const tokenRe =
    /(`[^`]+`|\[[^\]]+\]\(https?:\/\/[^\s)]+\)|\*\*[^*]+\*\*|\*[^*]+\*|https?:\/\/[^\s<>()]+)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let idx = 0;

  while ((match = tokenRe.exec(line)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(line.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith("`") && token.endsWith("`")) {
      nodes.push(<code key={`${keyPrefix}-c-${idx++}`}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("[") && token.includes("](") && token.endsWith(")")) {
      const linkMatch = token.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
      if (linkMatch && isSafeHttpUrl(linkMatch[2])) {
        nodes.push(
          <a
            key={`${keyPrefix}-ml-${idx++}`}
            href={linkMatch[2]}
            target="_blank"
            rel="noopener noreferrer"
          >
            {linkMatch[1]}
          </a>
        );
      } else {
        nodes.push(token);
      }
    } else if (token.startsWith("**") && token.endsWith("**")) {
      nodes.push(<strong key={`${keyPrefix}-b-${idx++}`}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("*") && token.endsWith("*")) {
      nodes.push(<em key={`${keyPrefix}-i-${idx++}`}>{token.slice(1, -1)}</em>);
    } else if (token.startsWith("http://") || token.startsWith("https://")) {
      const { url, trailing } = stripTrailingPunctuation(token);
      if (isSafeHttpUrl(url) && !IMAGE_EXT_RE.test(url)) {
        nodes.push(
          <a
            key={`${keyPrefix}-a-${idx++}`}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {url}
          </a>
        );
        if (trailing) nodes.push(trailing);
      } else if (isSafeHttpUrl(url)) {
        nodes.push(
          <a
            key={`${keyPrefix}-a-${idx++}`}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {url}
          </a>
        );
        if (trailing) nodes.push(trailing);
      } else {
        nodes.push(token);
      }
    } else {
      nodes.push(token);
    }
    lastIndex = match.index + token.length;
  }

  if (lastIndex < line.length) {
    nodes.push(line.slice(lastIndex));
  }
  return nodes;
}

const WebImageCard: React.FC<{
  item: ExtractedWebImage;
  onZoom: (img: ExtractedWebImage) => void;
}> = ({ item, onZoom }) => {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <a
        href={item.href || item.src}
        target="_blank"
        rel="noopener noreferrer"
        className="md-image-card fallback"
      >
        <div className="md-image-fallback">
          <ImageIcon size={20} />
          <span>Bild öffnen</span>
        </div>
        <div className="md-image-meta">
          <div className="md-image-caption">{item.alt}</div>
          {item.host && (
            <div className="md-image-source">
              <span>{item.host}</span>
              <ExternalLink size={11} />
            </div>
          )}
        </div>
      </a>
    );
  }

  return (
    <div className="md-image-card">
      <button
        type="button"
        className="md-image-thumb-btn"
        aria-label={`Bild vergrößern: ${item.alt}`}
        onClick={() => onZoom(item)}
      >
        <img
          src={item.src}
          alt={item.alt}
          className="md-image-thumb"
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      </button>
      <div className="md-image-meta">
        <div className="md-image-caption">{item.alt}</div>
        {item.host && (
          <a
            href={item.href || item.src}
            target="_blank"
            rel="noopener noreferrer"
            className="md-image-source"
          >
            <span>{item.host}</span>
            <ExternalLink size={11} />
          </a>
        )}
      </div>
    </div>
  );
};

/**
 * Opens the native iOS/mobile Share Sheet with the actual File (giving direct
 * "Bild sichern" into Photos gallery, AirDrop, WhatsApp, etc. without leaving
 * the standalone PWA). Falls back to a Blob download on desktop browsers.
 */
export async function shareOrSaveLocalMedia(src: string, filename: string): Promise<void> {
  const res = await fetch(src, { credentials: "same-origin" });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const blob = await res.blob();
  const mime = blob.type || "application/octet-stream";

  if (typeof File !== "undefined" && typeof navigator !== "undefined" && typeof navigator.share === "function") {
    const file = new File([blob], filename, { type: mime });
    const canShareFiles =
      typeof navigator.canShare === "function" ? navigator.canShare({ files: [file] }) : true;
    if (canShareFiles) {
      try {
        // Omit `title` / `text` so iOS Share Sheet "Kopieren" copies the actual
        // image/file binary instead of falling back to the filename text.
        await navigator.share({ files: [file] });
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }
      }
    }
  }

  // Desktop / fallback: trigger in-memory Blob download without navigating away
  const objectUrl = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
  }
}

const LocalMediaBlock: React.FC<{
  item: ExtractedLocalMedia;
  onZoom: (img: ExtractedWebImage) => void;
}> = ({ item, onZoom }) => {
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleAction = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await shareOrSaveLocalMedia(item.src, item.filename);
    } catch {
      // ignore fetch errors
    } finally {
      setBusy(false);
    }
  };

  if (item.kind === "image") {
    if (failed) {
      return (
        <button
          type="button"
          className="md-media-file-card"
          disabled={busy}
          onClick={() => void handleAction()}
        >
          <ImageIcon size={18} />
          <div className="md-media-file-info">
            <span className="md-media-file-name">{item.filename}</span>
            <span className="md-media-file-sub">
              {busy ? "Wird geladen…" : "Bild teilen / sichern"}
            </span>
          </div>
          <Share2 size={16} />
        </button>
      );
    }
    return (
      <div className="md-media-image-wrap">
        <button
          type="button"
          className="md-media-image-btn"
          aria-label={`Bild vergrößern: ${item.alt}`}
          onClick={() =>
            onZoom({
              src: item.src,
              alt: item.alt,
              host: "",
              isLocalMedia: true,
              downloadUrl: item.downloadUrl,
            })
          }
        >
          <img
            src={item.src}
            alt={item.alt}
            className="md-media-image"
            loading="lazy"
            onError={() => setFailed(true)}
          />
        </button>
      </div>
    );
  }

  if (item.kind === "audio") {
    return (
      <div className="md-media-audio-card">
        <div className="md-media-audio-head">
          <Volume2 size={15} />
          <span className="md-media-file-name">{item.filename}</span>
          <button
            type="button"
            className="md-media-dl-link"
            disabled={busy}
            aria-label={`${item.filename} teilen oder sichern`}
            onClick={() => void handleAction()}
          >
            <Share2 size={14} />
          </button>
        </div>
        <audio controls preload="metadata" src={item.src} className="md-media-audio" />
      </div>
    );
  }

  if (item.kind === "video") {
    return (
      <div className="md-media-video-wrap">
        <video controls playsInline preload="metadata" src={item.src} className="md-media-video" />
      </div>
    );
  }

  return (
    <button
      type="button"
      className="md-media-file-card"
      disabled={busy}
      onClick={() => void handleAction()}
    >
      <FileText size={18} />
      <div className="md-media-file-info">
        <span className="md-media-file-name">{item.filename}</span>
        <span className="md-media-file-sub">
          {busy ? "Wird geladen…" : "Datei teilen / sichern"}
        </span>
      </div>
      <Download size={16} />
    </button>
  );
};

/**
 * Copies the actual image binary directly into the system clipboard (preserving
 * iOS Safari user-gesture activation by passing the PNG Blob promise directly
 * into ClipboardItem).
 */
export async function copyImageToClipboard(src: string): Promise<boolean> {
  if (
    typeof navigator === "undefined" ||
    !navigator.clipboard ||
    typeof navigator.clipboard.write !== "function" ||
    typeof ClipboardItem === "undefined"
  ) {
    return false;
  }

  const pngBlobPromise = fetch(src, { credentials: "same-origin" })
    .then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      if (blob.type === "image/png") return blob;
      // Convert JPEG/WebP to PNG in-browser so iOS/Chromium ClipboardItem accepts it
      const bitmapUrl = URL.createObjectURL(blob);
      try {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const el = new Image();
          el.onload = () => resolve(el);
          el.onerror = reject;
          el.src = bitmapUrl;
        });
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return blob;
        ctx.drawImage(img, 0, 0);
        const png = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob((b) => resolve(b), "image/png")
        );
        return png || blob;
      } finally {
        URL.revokeObjectURL(bitmapUrl);
      }
    });

  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlobPromise })]);
    return true;
  } catch {
    return false;
  }
}

export const SafeMarkdown: React.FC<SafeMarkdownProps> = ({ text }) => {
  const [lightboxImg, setLightboxImg] = useState<ExtractedWebImage | null>(null);
  const [lightboxBusy, setLightboxBusy] = useState(false);
  const [lightboxCopied, setLightboxCopied] = useState(false);

  const { cleanedText, images, localMedia } = useMemo(() => {
    const local = extractLocalMediaAttachments(text);
    const web = extractWebSearchImages(local.cleanedText);
    return {
      cleanedText: web.cleanedText,
      images: web.images,
      localMedia: local.media,
    };
  }, [text]);

  if (!text) return null;

  // Split out fenced code blocks first
  const segments = cleanedText ? cleanedText.split(/(```[\s\S]*?```)/g) : [];
  const blocks: React.ReactNode[] = [];

  segments.forEach((segment, segIdx) => {
    if (!segment) return;

    if (segment.startsWith("```") && segment.endsWith("```")) {
      const inner = segment.slice(3, -3).replace(/^\w*\r?\n/, "");
      blocks.push(
        <pre key={`code-${segIdx}`}>
          <code>{inner}</code>
        </pre>
      );
      return;
    }

    const lines = segment.split(/\r?\n/);
    let listItems: string[] = [];
    let paraLines: string[] = [];

    const flushPara = (key: string) => {
      if (paraLines.length === 0) return;
      const content = paraLines.join("\n");
      paraLines = [];
      blocks.push(
        <p key={key}>
          {content.split("\n").map((ln, i) => (
            <React.Fragment key={i}>
              {i > 0 && <br />}
              {renderInline(ln, `${key}-${i}`)}
            </React.Fragment>
          ))}
        </p>
      );
    };

    const flushList = (key: string) => {
      if (listItems.length === 0) return;
      const items = [...listItems];
      listItems = [];
      blocks.push(
        <ul key={key}>
          {items.map((item, i) => (
            <li key={i}>{renderInline(item, `${key}-li-${i}`)}</li>
          ))}
        </ul>
      );
    };

    lines.forEach((line, lineIdx) => {
      const bulletMatch = line.match(/^\s*[-*•]\s+(.*)$/);
      if (bulletMatch) {
        flushPara(`p-${segIdx}-${lineIdx}`);
        listItems.push(bulletMatch[1]);
      } else if (line.trim() === "") {
        flushList(`ul-${segIdx}-${lineIdx}`);
        flushPara(`p-${segIdx}-${lineIdx}`);
      } else {
        flushList(`ul-${segIdx}-${lineIdx}`);
        paraLines.push(line);
      }
    });

    flushList(`ul-${segIdx}-end`);
    flushPara(`p-${segIdx}-end`);
  });

  return (
    <div className="md-body">
      {blocks}

      {localMedia.length > 0 && (
        <div className="md-local-media-list" aria-label="Erstellte Medien">
          {localMedia.map((item) => (
            <LocalMediaBlock key={item.path} item={item} onZoom={setLightboxImg} />
          ))}
        </div>
      )}

      {images.length > 0 && (
        <div
          className={`md-image-carousel ${images.length === 1 ? "single" : ""}`}
          aria-label="Bilder aus der Websuche"
        >
          {images.map((item) => (
            <WebImageCard key={item.src} item={item} onZoom={setLightboxImg} />
          ))}
        </div>
      )}

      {lightboxImg &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="image-lightbox-backdrop"
            role="dialog"
            aria-modal="true"
            aria-label={lightboxImg.alt}
            onClick={() => setLightboxImg(null)}
          >
            <div className="image-lightbox-content" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                className="icon-btn image-lightbox-close"
                aria-label="Schließen"
                onClick={() => setLightboxImg(null)}
              >
                <X size={20} />
              </button>
              <img
                src={lightboxImg.src}
                alt={lightboxImg.alt}
                className="image-lightbox-img"
                referrerPolicy="no-referrer"
              />
              <div className="image-lightbox-footer">
                <span className="image-lightbox-caption">{lightboxImg.alt}</span>
                {lightboxImg.isLocalMedia ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <button
                      type="button"
                      className="btn sm"
                      onClick={async () => {
                        const ok = await copyImageToClipboard(lightboxImg.src);
                        if (ok) {
                          setLightboxCopied(true);
                          setTimeout(() => setLightboxCopied(false), 1800);
                        }
                      }}
                    >
                      {lightboxCopied ? <Check size={14} /> : <Copy size={14} />}
                      {lightboxCopied ? "Kopiert" : "Kopieren"}
                    </button>
                    <button
                      type="button"
                      className="btn sm primary"
                      disabled={lightboxBusy}
                      onClick={async () => {
                        if (lightboxBusy) return;
                        setLightboxBusy(true);
                        try {
                          await shareOrSaveLocalMedia(lightboxImg.src, lightboxImg.alt);
                        } catch {
                          // ignore
                        } finally {
                          setLightboxBusy(false);
                        }
                      }}
                    >
                      <Share2 size={14} /> {lightboxBusy ? "Lädt…" : "Teilen / Sichern"}
                    </button>
                  </div>
                ) : (
                  <a
                    href={lightboxImg.href || lightboxImg.src}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn sm primary"
                  >
                    <ExternalLink size={14} /> Quelle öffnen
                  </a>
                )}
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};
