import { describe, expect, it } from "vitest";
import type { HermesProfile, HermesSessionSummary } from "../../shared/types";
import {
  BOT_CHAT_TITLE,
  buildGroupMembersPayload,
  deriveShortBotCallName,
  getBotHandle,
  pickPreferredBotSession,
} from "./botCollaboration";

const sampleProfiles: HermesProfile[] = [
  {
    name: "default",
    is_default: true,
    model: "gpt-6.1-terra",
    provider: "openai-codex",
    has_env: true,
    skill_count: 5,
    gateway_running: true,
    description: "Haupt-Assistent",
    display_name: "Hermes",
    bot_title: "",
  },
  {
    name: "clara-it",
    is_default: false,
    model: "gpt-6.1-terra",
    provider: "openai-codex",
    has_env: true,
    skill_count: 2,
    gateway_running: true,
    description: "IT-Spezialistin",
    display_name: "Clara-it",
    bot_title: "",
  },
];

describe("botCollaboration", () => {
  it("builds strict Hermes groups.create member payloads with member_id, handle, and local target", () => {
    const members = buildGroupMembersPayload(["default", "clara-it"], sampleProfiles);
    expect(members).toEqual([
      {
        member_id: "hermes",
        profile: "default",
        handle: "hermes",
        display_name: "Hermes",
        target: { kind: "local", profile: "default" },
      },
      {
        member_id: "clara-it",
        profile: "clara-it",
        handle: "clara-it",
        display_name: "Clara-it",
        target: { kind: "local", profile: "clara-it" },
      },
    ]);
  });

  it("keeps default handle as default if a named hermes profile exists", () => {
    expect(getBotHandle("default", ["default", "hermes"])).toBe("default");
    expect(getBotHandle("default", ["default", "mika"])).toBe("hermes");
  });

  it("prefers canonical Bot Chat and ignores background subagent/oneshot sessions", () => {
    const sessions: HermesSessionSummary[] = [
      { id: "s-sub", title: "Subagent: Check", source: "subagent" },
      { id: "s-one", title: null, source: "oneshot" },
      { id: "s-bot", title: BOT_CHAT_TITLE, source: "local" },
      { id: "s-old", title: "Alte Frage", source: "local" },
    ];
    expect(pickPreferredBotSession(sessions)?.id).toBe("s-bot");

    const withoutCanonical: HermesSessionSummary[] = [
      { id: "s-sub", title: "Subagent: Check", source: "subagent" },
      { id: "s-one", title: null, source: "oneshot" },
      { id: "s-chat", title: "PowerShell", source: "local" },
    ];
    expect(pickPreferredBotSession(withoutCanonical)?.id).toBe("s-chat");
  });

  it("derives short call names for natural teammate mentions without @", () => {
    expect(deriveShortBotCallName("clara-it")).toBe("Clara");
    expect(deriveShortBotCallName("Anna-coding")).toBe("Anna");
    expect(deriveShortBotCallName("nina-recherche")).toBe("Nina");
    expect(deriveShortBotCallName("mika")).toBe("Mika");
    expect(deriveShortBotCallName("default")).toBe("Hermes");
  });
});
