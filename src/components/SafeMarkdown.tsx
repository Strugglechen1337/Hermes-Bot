import React from "react";

interface SafeMarkdownProps {
  text: string;
}

function renderInline(line: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // Matches inline code, bold, italic, or https/http URLs
  const tokenRe = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|https?:\/\/[^\s<>()]+)/g;
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
    } else if (token.startsWith("**") && token.endsWith("**")) {
      nodes.push(<strong key={`${keyPrefix}-b-${idx++}`}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("*") && token.endsWith("*")) {
      nodes.push(<em key={`${keyPrefix}-i-${idx++}`}>{token.slice(1, -1)}</em>);
    } else if (token.startsWith("http://") || token.startsWith("https://")) {
      nodes.push(
        <a
          key={`${keyPrefix}-a-${idx++}`}
          href={token}
          target="_blank"
          rel="noopener noreferrer"
        >
          {token}
        </a>
      );
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

export const SafeMarkdown: React.FC<SafeMarkdownProps> = ({ text }) => {
  if (!text) return null;

  // Split out fenced code blocks first
  const segments = text.split(/(```[\s\S]*?```)/g);
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

  return <div className="md-body">{blocks}</div>;
};
