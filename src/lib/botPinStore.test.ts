import { describe, expect, it } from "vitest";
import type { HermesProfile } from "../../shared/types";
import { resolveChiefBotName, resolvePinnedBotNames } from "./botPinStore";

function makeProfile(
  name: string,
  pocketMeta?: Record<string, unknown>
): HermesProfile {
  return {
    name,
    is_default: name === "default",
    model: "claude-sonnet-4",
    provider: "anthropic",
    has_env: true,
    skill_count: 1,
    gateway_running: true,
    description: "",
    display_name: name,
    bot_title: name,
    ...(pocketMeta ? { ui_meta: { "hermes-pocket": pocketMeta } } : {}),
  };
}

describe("botPinStore", () => {
  it("resolves Chief from local selection first, then from Hermes ui_meta", () => {
    const profiles = [
      makeProfile("nova", { chief: true }),
      makeProfile("mika"),
      makeProfile("clara"),
    ];
    expect(resolveChiefBotName(profiles, null)).toBe("nova");
    expect(resolveChiefBotName(profiles, "mika")).toBe("mika");
    // Falls back to ui_meta when local selection no longer exists in public list
    expect(resolveChiefBotName(profiles, "deleted-bot")).toBe("nova");
  });

  it("resolves pinned showcase bots excluding the Chief and capping the count", () => {
    const profiles = [
      makeProfile("nova", { chief: true }),
      makeProfile("mika", { pinned: true }),
      makeProfile("lena"),
      makeProfile("mia", { pinned: true }),
      makeProfile("anna"),
    ];

    expect(resolvePinnedBotNames(profiles, ["nova", "lena"], "nova", 3)).toEqual([
      "lena",
      "mika",
      "mia",
    ]);
  });
});
