export interface DetectedSecretRequest {
  keyName: string;
  prompt: string;
  explicit: boolean;
}

const EXPLICIT_TAG_RE = /\[SECRET_REQUEST:\s*([A-Z][A-Z0-9_]{1,63})(?:\s*\|\s*([^\]]+))?\]/i;

const ENV_VAR_CANDIDATE_RE =
  /\b([A-Z][A-Z0-9_]{2,48}_(?:API_KEY|TOKEN|SECRET|PASSWORD|PASSWD|KEY|PAT|AUTH))\b/g;

const ASKING_PHRASES_RE =
  /\b(gib mir|schick(?:e)? mir|sende mir|bitte .{0,40}(?:eingeben|angeben|senden|schicken|hinterlegen|bereitstellen|teilen|eintragen)|brauche (?:ich )?(?:noch )?(?:einen?|deinen?|den|das)|benötige (?:ich )?(?:noch )?(?:einen?|deinen?|den|das)|bitte trag|hinterlege|please provide|please enter|need (?:your|the|an?) .{0,30}(?:api|token|password|secret|key)|paste (?:your|the))\b/i;

const SECRET_NOUN_RE =
  /\b(api[- ]?key|api[- ]?token|api[- ]?schlüssel|access[- ]?token|bearer[- ]?token|long[- ]?lived[- ]?access[- ]?token|token|passwort|password|geheimnis|secret|zugangsdaten|app[- ]?passwort)\b/i;

const REFUSAL_OR_PAST_RE =
  /\b(würde ich nicht|nicht über einen normalen chat|erfolgreich gespeichert|wurde hinterlegt|bereits hinterlegt)\b/i;

function inferKeyFromContext(text: string): string {
  const lower = text.toLowerCase();
  if (/home\s*assistant|\bha\b/.test(lower)) return "HOME_ASSISTANT_TOKEN";
  if (/fritz!?box/.test(lower)) return "FRITZBOX_PASSWORD";
  if (/pi-?hole/.test(lower)) return "PIHOLE_API_KEY";
  if (/github/.test(lower)) return "GITHUB_TOKEN";
  if (/cloudflare/.test(lower)) return "CLOUDFLARE_API_TOKEN";
  if (/telegram/.test(lower)) return "TELEGRAM_BOT_TOKEN";
  if (/discord/.test(lower)) return "DISCORD_TOKEN";
  if (/imap|smtp|mail|e-?mail/.test(lower)) return "EMAIL_PASSWORD";
  if (/passwort|password/.test(lower)) return "SERVICE_PASSWORD";
  return "SERVICE_API_TOKEN";
}

/**
 * Inspects a completed bot message and detects when the bot is asking the user
 * to supply an API key, token, or password so Hermes Pocket can automatically
 * pop up the secure masked input box right inside the chat.
 */
export function detectBotSecretRequest(text: string): DetectedSecretRequest | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  // 1. Explicit structured tag (highest confidence)
  const tagMatch = trimmed.match(EXPLICIT_TAG_RE);
  if (tagMatch) {
    return {
      keyName: tagMatch[1].toUpperCase(),
      prompt: (tagMatch[2] || `Bitte gib den Wert für ${tagMatch[1].toUpperCase()} sicher ein.`).trim(),
      explicit: true,
    };
  }

  // 2. Avoid false positives on security refusals or past-tense confirmations
  if (REFUSAL_OR_PAST_RE.test(trimmed)) {
    return null;
  }

  // 3. Natural language request for a key/token/password
  const envMatches = Array.from(trimmed.matchAll(ENV_VAR_CANDIDATE_RE)).map((m) => m[1]);
  if ((!SECRET_NOUN_RE.test(trimmed) && envMatches.length === 0) || !ASKING_PHRASES_RE.test(trimmed)) {
    return null;
  }

  // Prefer explicit UPPER_SNAKE_CASE env var mentioned in the bot's reply
  const keyName = envMatches[0] || inferKeyFromContext(trimmed);

  return {
    keyName,
    prompt: `Sichere Eingabe für ${keyName} – wird direkt in der geschützten .env des Bots gespeichert.`,
    explicit: false,
  };
}

/**
 * Strips any internal `[SECRET_REQUEST: ...]` directive from rendered markdown
 * so the user only sees clean prose plus the interactive security box below.
 */
export function stripSecretRequestTag(text: string): string {
  return text.replace(EXPLICIT_TAG_RE, "").trim();
}
