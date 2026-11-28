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

describe("approval rules", () => {
  const rules = [
    { id: "1", match: "docker ps", action: "allow" as const },
    { id: "2", match: "kubectl", action: "ask" as const },
    { id: "3", match: "rm -rf", action: "allow" as const },
    { id: "4", match: "nur-mia", action: "allow" as const, profile: "mia" },
  ];
  it("ask rule wins, allow rule works in manual mode, protections stay", () => {
    expect(evaluateApprovalPolicy({ command: "docker ps -a" }, false, rules).action).toBe("auto_once");
    expect(evaluateApprovalPolicy({ command: "kubectl get pods" }, true, rules)).toMatchObject({ action: "ask", category: "rule" });
    expect(evaluateApprovalPolicy({ command: "rm -rf /tmp/x" }, true, rules)).toMatchObject({ action: "ask", category: "destructive" });
  });
  it("respects per-bot rules", () => {
    expect(evaluateApprovalPolicy({ command: "nur-mia" }, false, rules, "emma").action).toBe("ask");
    expect(evaluateApprovalPolicy({ command: "nur-mia" }, false, rules, "mia").action).toBe("auto_once");
  });
});
