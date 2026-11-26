import { describe, expect, it } from "vitest";
import type { HermesProfile } from "../../shared/types";
import {
  cleanSearchSnippet,
  hashVaultPin,
  isProfilePrivate,
} from "./privateVault";

const baseProfile: HermesProfile = {
  name: "privat-bot",
  is_default: false,
  model: "gpt-6.1-terra",
  provider: "openai-codex",
  has_env: true,
  skill_count: 0,
  gateway_running: true,
  description: "",
  display_name: "Privat",
  bot_title: "Privat",
};

describe("privateVault", () => {
  it("detects private profiles from Hermes ui_meta and refuses marking default private", () => {
    expect(isProfilePrivate(baseProfile, [])).toBe(false);
    expect(
      isProfilePrivate(
        { ...baseProfile, ui_meta: { "hermes-pocket": { private: true } } },
        []
      )
    ).toBe(true);
    expect(isProfilePrivate(baseProfile, ["privat-bot"])).toBe(true);
    expect(
      isProfilePrivate(
        { ...baseProfile, name: "default", is_default: true, ui_meta: { "hermes-pocket": { private: true } } },
        ["default"]
      )
    ).toBe(false);
  });

  it("hashes vault PIN deterministically", async () => {
    const a = await hashVaultPin("1234");
    const b = await hashVaultPin("1234");
    const c = await hashVaultPin("5678");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("strips FTS markup from search snippets safely", () => {
    expect(cleanSearchSnippet("Hallo <mark>PowerShell</mark>  Skript\nfertig")).toBe(
      "Hallo PowerShell Skript fertig"
    );
  });
});
