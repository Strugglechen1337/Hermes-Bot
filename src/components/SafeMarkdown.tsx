import React, { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, Image as ImageIcon, X } from "lucide-react";

interface SafeMarkdownProps {
  text: string;
}

export interface ExtractedWebImage {
  src: string;
  alt: string;
  href?: string;
  host: string;
}

const IMAGE_EXT_RE = /\.(?:jpe?g|png|webp|gif|avif)(?:[?#][^\s<>()]*)?$/i;

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

export const SafeMarkdown: React.FC<SafeMarkdownProps> = ({ text }) => {
  const [lightboxImg, setLightboxImg] = useState<ExtractedWebImage | null>(null);

  const { cleanedText, images } = useMemo(() => extractWebSearchImages(text), [text]);

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
                <a
                  href={lightboxImg.href || lightboxImg.src}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn sm primary"
                >
                  <ExternalLink size={14} /> Quelle öffnen
                </a>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};
