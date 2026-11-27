import { describe, expect, it } from "vitest";
import type { HermesModelOptionProvider } from "../../shared/types";
import {
  buildAutoAssignPlan,
  classifyBotModelTier,
  recommendGptModelForBot,
} from "./smartModelRouting";

const SAMPLE_PROVIDERS: HermesModelOptionProvider[] = [
  {
    slug: "openai-codex",
    name: "OpenAI Codex",
    is_current: true,
    featured_models: ["gpt-6.1-terra", "gpt-5.4-mini", "gpt-5.4-nano"],
    models: ["gpt-6.1-terra", "gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano"],
  },
  {
    slug: "anthropic",
    name: "Anthropic",
    is_current: false,
    featured_models: ["claude-sonnet-4.6"],
    models: ["claude-sonnet-4.6"],
  },
];

describe("smartModelRouting", () => {
  it("classifies coding, IT, research, and chief bots as pro; mail/calendar as fast; shopping/news as balanced", () => {
    expect(classifyBotModelTier({ name: "anna-coding" }).tier).toBe("pro");
    expect(classifyBotModelTier({ name: "clara-it" }).tier).toBe("pro");
    expect(classifyBotModelTier({ name: "nova-chief" }).tier).toBe("pro");
    expect(classifyBotModelTier({ name: "nina-recherche" }).tier).toBe("pro");
    expect(classifyBotModelTier({ name: "default" }).tier).toBe("pro");

    expect(classifyBotModelTier({ name: "lena-kalender" }).tier).toBe("fast");
    expect(
      classifyBotModelTier({ name: "mika", description: "Prüft Gmail-Posteingang und DHL Pakete" })
        .tier
    ).toBe("fast");

    expect(classifyBotModelTier({ name: "mia-einkauf" }).tier).toBe("balanced");
    expect(classifyBotModelTier({ name: "lea-news" }).tier).toBe("balanced");
  });

  it("recommends the matching live openai-codex GPT model per bot tier", () => {
    const anna = recommendGptModelForBot({ name: "anna-coding" }, SAMPLE_PROVIDERS);
    expect(anna?.provider).toBe("openai-codex");
    expect(anna?.model).toBe("gpt-6.1-terra");

    const mia = recommendGptModelForBot({ name: "mia-einkauf" }, SAMPLE_PROVIDERS);
    expect(mia?.model).toBe("gpt-5.4-mini");

    const lena = recommendGptModelForBot({ name: "lena-kalender" }, SAMPLE_PROVIDERS);
    expect(lena?.model).toBe("gpt-5.4-nano");
  });

  it("builds a complete auto-assign plan across multiple profiles", () => {
    const plan = buildAutoAssignPlan(
      [
        { name: "anna-coding", display_name: "Anna", description: "Code & Releases" },
        { name: "mia-einkauf", display_name: "Mia", description: "Deals & Einkauf" },
        { name: "lena-kalender", display_name: "Lena", description: "Termine & Kalender" },
      ],
      SAMPLE_PROVIDERS
    );
    expect(plan).toHaveLength(3);
    expect(plan.map((p) => p.recommendation.model)).toEqual([
      "gpt-6.1-terra",
      "gpt-5.4-mini",
      "gpt-5.4-nano",
    ]);
  });
});
