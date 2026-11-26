import { describe, expect, it } from "vitest";
import type {
  HermesChatMessage,
  HermesRoom,
  HermesSessionSummary,
} from "../../shared/types";
import {
  buildReadCursorFromSession,
  detectGroupUnread,
  detectUnreadAssistantMessages,
  formatBadgeCount,
  formatUnreadPreview,
  hasSessionNewActivity,
  pickSessionForUnreadCheck,
} from "./unreadStore";

describe("unreadStore", () => {
  it("prefers canonical Bot Chat / Privater Chat and skips internal subagent sessions", () => {
    const sessions: HermesSessionSummary[] = [
      { id: "sub-1", title: "subagent: lookup", source: "subagent", last_active: 3000 },
      { id: "s-other", title: "Chat 12:00", source: "gui", last_active: 2000 },
      { id: "s-canon", title: "Bot Chat", source: "gui", last_active: 1500 },
    ];
    expect(pickSessionForUnreadCheck(sessions, false)?.id).toBe("s-canon");

    const privSessions: HermesSessionSummary[] = [
      { id: "sub-2", title: "subagent: helper", source: "subagent", last_active: 5000 },
      { id: "p-canon", title: "Privater Chat", source: "gui", last_active: 4000 },
    ];
    expect(pickSessionForUnreadCheck(privSessions, true)?.id).toBe("p-canon");

    const withoutCanon: HermesSessionSummary[] = [
      { id: "sub-3", title: "subagent: work", source: "subagent", last_active: 9000 },
      { id: "gui-1", title: "Unterhaltung", source: "gui", last_active: 8000 },
    ];
    expect(pickSessionForUnreadCheck(withoutCanon, false)?.id).toBe("gui-1");
  });

  it("does not trigger false unread when no baseline cursor exists yet", () => {
    const session: HermesSessionSummary = {
      id: "s1",
      title: "Bot Chat",
      last_active: 1_700_000_000_000,
      message_count: 10,
    };
    expect(hasSessionNewActivity(session, undefined)).toBe(false);
  });

  it("detects new activity when message_count or last_active increases beyond cursor", () => {
    const session: HermesSessionSummary = {
      id: "s1",
      title: "Bot Chat",
      last_active: 1_700_000_000_000,
      message_count: 10,
    };
    const cursor = buildReadCursorFromSession(session, undefined, 1_700_000_000_500)!;
    expect(hasSessionNewActivity(session, cursor)).toBe(false);

    expect(
      hasSessionNewActivity({ ...session, message_count: 11 }, cursor)
    ).toBe(true);
    expect(
      hasSessionNewActivity({ ...session, last_active: 1_700_000_005_000 }, cursor)
    ).toBe(true);
  });

  it("confirms unread only when latest message is from assistant (no false positives for user-only turns)", () => {
    const cursor = {
      sessionId: "s1",
      lastActiveMs: 1_700_000_000_000,
      messageCount: 2,
      readAtMs: 1_700_000_000_100,
    };

    const userOnly: HermesChatMessage[] = [
      { id: 1, role: "user", content: "Hallo", timestamp: 1_699_999_999_000 },
      { id: 2, role: "assistant", content: "Hi!", timestamp: 1_700_000_000_000 },
      { id: 3, role: "user", content: "Such mal was raus", timestamp: 1_700_000_010_000 },
    ];
    expect(
      detectUnreadAssistantMessages(userOnly, cursor, 1_700_000_010_000, "s1")
    ).toBeNull();

    const withBotReplies: HermesChatMessage[] = [
      ...userOnly,
      {
        id: 4,
        role: "assistant",
        content: "**Fertig!** Ich habe 3 Ergebnisse gefunden [SECRET_REQUEST: TOKEN | Key]",
        timestamp: 1_700_000_020_000,
      },
      {
        id: 5,
        role: "assistant",
        content: "Schau dir gern das erste Angebot an.",
        timestamp: 1_700_000_025_000,
      },
    ];
    const detected = detectUnreadAssistantMessages(
      withBotReplies,
      cursor,
      1_700_000_025_000,
      "s1"
    );
    expect(detected).not.toBeNull();
    expect(detected?.count).toBe(2);
    expect(detected?.preview).toBe("Schau dir gern das erste Angebot an.");
    expect(detected?.latestTimestampMs).toBe(1_700_000_025_000);
  });

  it("strips markdown & internal tags cleanly in previews", () => {
    expect(
      formatUnreadPreview(
        "**Ergebnis:** Schau auf [Otto](https://otto.de) vorbei [DEAL_CARD: Otto | Test | 10 € | | https://otto.de]"
      )
    ).toBe("Ergebnis: Schau auf Otto vorbei");
    expect(formatBadgeCount(0)).toBe("");
    expect(formatBadgeCount(3)).toBe("3");
    expect(formatBadgeCount(142)).toBe("99+");
  });

  it("detects unread updates in group rooms based on latest_seq", () => {
    const room: HermesRoom = {
      room_id: "r1",
      name: "Team",
      members: [],
      authority_gateway_id: "gw",
      authority_epoch: 1,
      revision: 1,
      created_at: 1000,
      updated_at: 2000,
      latest_seq: 12,
    };
    expect(detectGroupUnread(room, undefined)).toBeNull();
    expect(detectGroupUnread(room, { latestSeq: 12, updatedAtMs: 2000 })).toBeNull();
    const unread = detectGroupUnread(room, { latestSeq: 9, updatedAtMs: 1500 });
    expect(unread?.count).toBe(3);
    expect(unread?.latestSeq).toBe(12);
  });
});
