import { describe, expect, it } from "vitest";
import { evaluateApprovalPolicy } from "./approvalPolicy";

describe("approvalPolicy", () => {
  it("auto-approves normal non-destructive commands when enabled", () => {
    expect(
      evaluateApprovalPolicy(
        {
          tool_name: "terminal",
          command: "curl -s http://127.0.0.1:8123/api/states",
          description: "Home Assistant Status prüfen",
        },
        true
      )
    ).toEqual({ action: "auto_once" });

    expect(
      evaluateApprovalPolicy(
        {
          tool_name: "execute_code",
          description: "Python-Skript zur Auswertung ausführen",
        },
        true
      )
    ).toEqual({ action: "auto_once" });
  });

  it("ALWAYS asks manually for email actions", () => {
    const res = evaluateApprovalPolicy(
      {
        tool_name: "send_email",
        description: "E-Mail an Empfänger senden",
      },
      true
    );
    expect(res.action).toBe("ask");
    expect(res.category).toBe("mail");
  });

  it("ALWAYS asks manually for destructive deletion commands", () => {
    for (const cmd of [
      "rm -rf /home/user/projekt",
      "find /tmp/data -delete",
      "DROP TABLE sessions;",
      "git reset --hard HEAD~3",
      "systemctl stop hermes-gateway.service",
    ]) {
      const res = evaluateApprovalPolicy({ command: cmd }, true);
      expect(res.action).toBe("ask");
      expect(res.category).toBe("destructive");
    }
  });

  it("ALWAYS asks manually for sensitive SSH/system auth paths", () => {
    const res = evaluateApprovalPolicy(
      { command: "cat key.pub >> ~/.ssh/authorized_keys" },
      true
    );
    expect(res.action).toBe("ask");
    expect(res.category).toBe("sensitive");
  });

  it("ALWAYS asks manually when auto-approve toggle is turned off", () => {
    const res = evaluateApprovalPolicy(
      { command: "ls -la" },
      false
    );
    expect(res.action).toBe("ask");
    expect(res.category).toBe("manual");
  });
});
