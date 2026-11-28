import type { HermesPendingApproval } from "../../shared/types";

const AUTO_APPROVE_STORAGE_KEY = "hermes-pocket.autoApproveSafe";

export function loadAutoApproveSafe(): boolean {
  try {
    const raw = localStorage.getItem(AUTO_APPROVE_STORAGE_KEY);
    if (raw === null) return true; // Default ON per user preference (except mail & deletions)
    return raw === "true";
  } catch {
    return true;
  }
}

export function saveAutoApproveSafe(enabled: boolean): void {
  try {
    localStorage.setItem(AUTO_APPROVE_STORAGE_KEY, enabled ? "true" : "false");
  } catch {
    // ignore storage errors
  }
}

const MAIL_ACTION_RE =
  /\b(e-?mail|mails?|imap|smtp|gmail|outlook|sendmail|mailx|postfach|inbox|send_email|reply_email|forward_email|delete_email|compose_email|draft_email|newsletter)\b/i;

const DESTRUCTIVE_ACTION_RE =
  /(?:^|[\s;|&`(])(rm\s+-[a-z]*[rf]|rm\s+\/|rmdir\b|unlink\b|shred\b|wipe\b|dd\s+if=|mkfs\b|fdisk\b|parted\b|truncate\b|wipefs\b)|\bfind\b[^;\n]*\s-delete\b|\bxargs\b[^;\n]*\brm\b|\bgit\s+(?:reset\s+--hard|clean\s+-[a-z]*f|push\s+(?:--force|-f))\b|\b(?:drop\s+(?:table|database|schema)|delete\s+from|truncate\s+table)\b|\b(?:recursive\s+delete|delete\s+in\s+root|purge\s+all|destroy|uninstall|format\s+\/|löschen|loeschen)\b|\b(?:hermes\s+update|systemctl\s+(?:stop|restart|disable)\s+hermes)\b/i;

const SENSITIVE_SYSTEM_PATH_RE =
  /(\.ssh\/|authorized_keys|\/etc\/passwd|\/etc\/shadow|\/etc\/sudoers|\bid_rsa\b|\bid_ed25519\b)/i;

const RULES_STORAGE_KEY = "hermes-pocket.approvalRules";

/** A user rule: when the request text contains `match`, always allow it or always ask. */
export interface ApprovalRule {
  id: string;
  match: string;
  action: "allow" | "ask";
  /** Only for this bot (profile name); empty = every bot. */
  profile?: string;
}

export function loadApprovalRules(): ApprovalRule[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RULES_STORAGE_KEY) || "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (r): r is ApprovalRule =>
        !!r &&
        typeof r.id === "string" &&
        typeof r.match === "string" &&
        r.match.trim().length > 0 &&
        (r.action === "allow" || r.action === "ask")
    );
  } catch {
    return [];
  }
}

export function saveApprovalRules(rules: ApprovalRule[]): void {
  try {
    localStorage.setItem(RULES_STORAGE_KEY, JSON.stringify(rules.slice(0, 50)));
  } catch {
    // ignore storage errors
  }
}

export interface ApprovalPolicyDecision {
  action: "auto_once" | "ask";
  category?: "mail" | "destructive" | "sensitive" | "manual" | "rule";
  reason?: string;
}

/**
 * Evaluates whether an incoming Hermes approval request can be auto-approved
 * safely ("once") or MUST stop for explicit user confirmation.
 *
 * Always requires manual confirmation for:
 * - Any email / mail-related action
 * - Any destructive / deletion action (rm, unlink, drop, delete, force-reset, gateway stop)
 * - Sensitive credential / SSH / system auth paths
 */
export function evaluateApprovalPolicy(
  approval: HermesPendingApproval,
  autoApproveSafeEnabled: boolean,
  rules: ApprovalRule[] = [],
  profile?: string
): ApprovalPolicyDecision {
  const combined = [
    approval.tool_name,
    approval.command,
    approval.description,
    approval.label,
    approval.path,
    approval.host,
    approval.risk,
    approval.reason,
  ]
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .join(" ");

  const applicable = rules.filter((r) => !r.profile || r.profile === profile);
  const hit = (action: ApprovalRule["action"]) =>
    applicable.find((r) => r.action === action && combined.toLowerCase().includes(r.match.trim().toLowerCase()));

  const askRule = hit("ask");
  if (askRule) {
    return { action: "ask", category: "rule", reason: `Deine Regel: immer fragen bei „${askRule.match}“` };
  }

  const protectedHit =
    MAIL_ACTION_RE.test(combined) || DESTRUCTIVE_ACTION_RE.test(combined) || SENSITIVE_SYSTEM_PATH_RE.test(combined);
  // Allow rules never lift the built-in protection for mail, deletions and sensitive files.
  if (!protectedHit && hit("allow")) return { action: "auto_once" };

  if (!autoApproveSafeEnabled) {
    return { action: "ask", category: "manual", reason: "Manuelle Freigabe aktiv" };
  }

  if (MAIL_ACTION_RE.test(combined)) {
    return {
      action: "ask",
      category: "mail",
      reason: "E-Mail-Aktion erfordert immer deine Bestätigung",
    };
  }

  if (DESTRUCTIVE_ACTION_RE.test(combined)) {
    return {
      action: "ask",
      category: "destructive",
      reason: "Lösch- oder System-Aktion erfordert immer deine Bestätigung",
    };
  }

  if (SENSITIVE_SYSTEM_PATH_RE.test(combined)) {
    return {
      action: "ask",
      category: "sensitive",
      reason: "Zugriff auf sensible System-/SSH-Dateien erfordert deine Bestätigung",
    };
  }

  return { action: "auto_once" };
}
