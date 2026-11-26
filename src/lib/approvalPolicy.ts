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
  /(?:^|[\s;|&`(])(rm\s|rm$|rmdir\b|unlink\b|shred\b|wipe\b|dd\s+if=|mkfs\b|fdisk\b|parted\b|truncate\b|wipefs\b)|\bfind\b[^;\n]*\s-delete\b|\bxargs\b[^;\n]*\brm\b|\bgit\s+(?:reset\s+--hard|clean\s+-[a-z]*f|push\s+(?:--force|-f))\b|\b(?:drop\s+(?:table|database|schema)|delete\s+from|truncate\s+table)\b|\b(?:delete|purge|destroy|format|uninstall|remove_all|löschen|loeschen|entfernen)\b|\b(?:hermes\s+update|systemctl\s+(?:stop|restart|disable)\s+hermes)\b/i;

const SENSITIVE_SYSTEM_PATH_RE =
  /(\.ssh\/|authorized_keys|\/etc\/passwd|\/etc\/shadow|\/etc\/sudoers|\bid_rsa\b|\bid_ed25519\b)/i;

export interface ApprovalPolicyDecision {
  action: "auto_once" | "ask";
  category?: "mail" | "destructive" | "sensitive" | "manual";
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
  autoApproveSafeEnabled: boolean
): ApprovalPolicyDecision {
  if (!autoApproveSafeEnabled) {
    return { action: "ask", category: "manual", reason: "Manuelle Freigabe aktiv" };
  }

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
