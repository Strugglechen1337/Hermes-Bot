import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SafeMarkdown } from "./SafeMarkdown";

describe("SafeMarkdown", () => {
  it("renders bold, inline code, lists, and code blocks safely without executing HTML", () => {
    const { container } = render(
      <SafeMarkdown
        text={
          "Hallo **Mika**, prüfe `inbox`:\n\n- Punkt eins\n- <script>alert('xss')</script>\n\n```ts\nconst ok = true;\n```"
        }
      />
    );

    expect(screen.getByText("Mika").tagName).toBe("STRONG");
    expect(screen.getByText("inbox").tagName).toBe("CODE");
    expect(screen.getByText("Punkt eins")).toBeInTheDocument();
    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByText("<script>alert('xss')</script>")).toBeInTheDocument();
    expect(screen.getByText("const ok = true;")).toBeInTheDocument();
  });
});
