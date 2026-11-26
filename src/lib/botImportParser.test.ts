import { describe, expect, it } from "vitest";
import { buildHermesSoulDocument, parseBotImportText } from "./botImportParser";

describe("botImportParser", () => {
  it("parses a fenced JSON Grok-Bot export cleanly", () => {
    const raw = [
      "Hier ist mein Export:",
      "```json",
      JSON.stringify({
        name: "Fitness Coach",
        description: "Trainings- und Ernährungsbegleiter",
        soul: "Du bist ein direkter, motivierender Coach.",
        memories: ["Trainiert 3x pro Woche", "Mag kurze Antworten"],
        routines: [
          {
            name: "Wochencheck",
            schedule: "Sonntags 18:00",
            prompt: "Frage nach Trainingsfortschritt",
          },
        ],
        integrations: ["Google Kalender"],
      }),
      "```",
    ].join("\n");

    const parsed = parseBotImportText(raw);
    expect(parsed).not.toBeNull();
    expect(parsed?.format).toBe("json");
    expect(parsed?.name).toBe("Fitness Coach");
    expect(parsed?.slug).toBe("fitness-coach");
    expect(parsed?.memories).toHaveLength(2);
    expect(parsed?.routines).toHaveLength(1);
    expect(parsed?.integrations).toEqual(["Google Kalender"]);

    const soulDoc = buildHermesSoulDocument(parsed!);
    expect(soulDoc).toContain("# Fitness Coach");
    expect(soulDoc).toContain("## Importierte Erinnerungen");
    expect(soulDoc).toContain("- Trainiert 3x pro Woche");
    expect(soulDoc).toContain("Standardmäßig pausiert");
    expect(soulDoc).toContain("## Eigenständige Arbeitsweise (Hermes Pocket)");
  });

  it("falls back cleanly to Markdown/free-text export", () => {
    const parsed = parseBotImportText("# Reiseplaner\nRolle: Plant Urlaubsrouten\nAntworte auf Deutsch.");
    expect(parsed?.format).toBe("text");
    expect(parsed?.name).toBe("Reiseplaner");
    expect(parsed?.slug).toBe("reiseplaner");
    expect(parsed?.description).toBe("Plant Urlaubsrouten");
  });
});
