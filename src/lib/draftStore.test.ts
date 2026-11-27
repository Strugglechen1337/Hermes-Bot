// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { loadAllBotDrafts, loadBotDraft, saveBotDraft } from "./draftStore";

describe("draftStore", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("saves, loads, lists, and clears per-bot drafts cleanly", () => {
    expect(loadBotDraft("nova-chief")).toBe("");
    saveBotDraft("nova-chief", "Bitte prüfe morgen früh das Wetter");
    saveBotDraft("anna-coding", "Erstelle ein neues Icon");

    expect(loadBotDraft("nova-chief")).toBe("Bitte prüfe morgen früh das Wetter");
    expect(loadAllBotDrafts()).toEqual({
      "nova-chief": "Bitte prüfe morgen früh das Wetter",
      "anna-coding": "Erstelle ein neues Icon",
    });

    // Clearing whitespace-only draft removes it
    saveBotDraft("nova-chief", "   ");
    expect(loadBotDraft("nova-chief")).toBe("");
    expect(loadAllBotDrafts()).toEqual({
      "anna-coding": "Erstelle ein neues Icon",
    });
  });
});
