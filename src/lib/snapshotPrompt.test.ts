import { describe, expect, it } from "vitest";
import { splitSnapshotPrompt } from "./snapshotPrompt";

describe("splitSnapshotPrompt", () => {
  it("keeps real approvals as approvals", () => {
    const p = { kind: "command", prompt_id: "a1", command: "ls" };
    expect(splitSnapshotPrompt(p)).toEqual({ approval: p, clarify: null });
  });

  it("turns a clarify prompt into a question card instead of an approval card", () => {
    const r = splitSnapshotPrompt({
      kind: "clarify",
      prompt_id: "c1",
      question: "Welche Methode?",
      choices: ["WhatsApp", "Anruf"],
    });
    expect(r.approval).toBeNull();
    expect(r.clarify?.id).toBe("c1");
    expect(r.clarify?.params.question).toBe("Welche Methode?");
    expect(r.clarify?.params.choices).toEqual(["WhatsApp", "Anruf"]);
    expect(r.clarify?.params.__snapshot).toBe(true);
  });

  it("returns nothing for no prompt", () => {
    expect(splitSnapshotPrompt(null)).toEqual({ approval: null, clarify: null });
  });
});
