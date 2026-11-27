// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SafeMarkdown, extractWebSearchImages } from "./SafeMarkdown";

afterEach(() => {
  cleanup();
});

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

  it("renders web search markdown images & direct image URLs in a horizontal swipeable carousel with lightbox", () => {
    const text =
      "Hier sind passende Ergebnisse:\n\n" +
      "[![Produkt Eins](https://cdn.example.com/img1.jpg)](https://shop.example.com/p1)\n" +
      "![Produkt Zwei](https://cdn.example.com/img2.webp?w=600)\n" +
      "https://cdn.example.com/img3.png\n" +
      "Und ein Link: [Mehr Infos](https://shop.example.com/info)";

    render(<SafeMarkdown text={text} />);

    expect(screen.getByText(/Hier sind passende Ergebnisse/i)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Mehr Infos" });
    expect(link).toHaveAttribute("href", "https://shop.example.com/info");

    const carousel = screen.getByLabelText("Bilder aus der Websuche");
    const imgs = carousel.querySelectorAll("img");
    expect(imgs).toHaveLength(3);
    expect(imgs[0]).toHaveAttribute("src", "https://cdn.example.com/img1.jpg");
    expect(imgs[1]).toHaveAttribute("src", "https://cdn.example.com/img2.webp?w=600");
    expect(imgs[2]).toHaveAttribute("src", "https://cdn.example.com/img3.png");

    // Tap first image to open fullscreen lightbox
    fireEvent.click(screen.getByRole("button", { name: /Bild vergrößern: Produkt Eins/i }));
    const dialog = screen.getByRole("dialog", { name: "Produkt Eins" });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Quelle öffnen/i })).toHaveAttribute(
      "href",
      "https://shop.example.com/p1"
    );

    // Close lightbox
    fireEvent.click(screen.getByRole("button", { name: "Schließen" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    // Graceful fallback if an external image fails to load
    fireEvent.error(imgs[1]);
    expect(screen.getByText("Bild öffnen")).toBeInTheDocument();
  });

  it("never renders unsafe javascript: or data: image URLs", () => {
    const { images } = extractWebSearchImages(
      "![bad](javascript:alert(1)) ![also-bad](data:text/html,<script>1</script>)"
    );
    expect(images).toHaveLength(0);
  });

  it("renders native Hermes MEDIA:/path attachments directly inline instead of raw paths", () => {
    const text =
      "Klar, hier ist dein Bild:\n\n" +
      "MEDIA:/home/user/.hermes/profiles/anna-coding/cache/scratch/anime-charakter.png";

    render(<SafeMarkdown text={text} />);

    expect(screen.getByText(/Klar, hier ist dein Bild/i)).toBeInTheDocument();
    expect(screen.queryByText(/MEDIA:/i)).toBeNull();

    const img = screen.getByRole("img", { name: "anime-charakter.png" });
    expect(img).toHaveAttribute(
      "src",
      "/api/pocket/media?path=%2Fhome%2Fuser%2F.hermes%2Fprofiles%2Fanna-coding%2Fcache%2Fscratch%2Fanime-charakter.png"
    );

    fireEvent.click(screen.getByRole("button", { name: /Bild vergrößern: anime-charakter\.png/i }));
    expect(screen.getByRole("dialog", { name: "anime-charakter.png" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Kopieren/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Teilen \/ Sichern/i })).toBeInTheDocument();
  });
});
