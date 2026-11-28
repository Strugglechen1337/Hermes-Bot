import type { VaultItemKind } from "./vaultClient";

export interface DetectedSecretRequest {
  keyName: string;
  prompt: string;
  explicit: boolean;
}

export interface DetectedSecretForm {
  title: string;
  fields: DetectedSecretRequest[];
  explicit: boolean;
}

export interface DetectedVaultRequest {
  kind: VaultItemKind;
  prompt: string;
  origin?: string;
  explicit: boolean;
}

export interface DetectedDealCard {
  shop: string;
  title: string;
  price: string;
  oldPrice?: string;
  url: string;
  imageUrl?: string;
}

const EXPLICIT_FORM_TITLE_RE = /\[SECRET_FORM:\s*([^\]]+)\]/i;
const EXPLICIT_FORM_TITLE_GLOBAL_RE = /\[SECRET_FORM:\s*([^\]]+)\]/gi;
const EXPLICIT_TAG_GLOBAL_RE = /\[SECRET_REQUEST:\s*([A-Z][A-Z0-9_]{1,63})(?:\s*\|\s*([^\]]+))?\]/gi;
const EXPLICIT_VAULT_RE =
  /\[VAULT_REQUEST:\s*(payment|address|login)(?:\s*\|\s*([^|\]]+))?(?:\s*\|\s*([^\]]+))?\]/i;
const EXPLICIT_VAULT_GLOBAL_RE =
  /\[VAULT_REQUEST:\s*(payment|address|login)(?:\s*\|\s*([^|\]]+))?(?:\s*\|\s*([^\]]+))?\]/gi;
const EXPLICIT_DEAL_GLOBAL_RE =
  /\[DEAL_CARD:\s*([^|\]]+)\|\s*([^|\]]+)\|\s*([^|\]]+)(?:\|\s*([^|\]]*))?(?:\|\s*([^|\]]*))?(?:\|\s*([^\]]+))?\]/gi;
const POCKET_PAGE_GLOBAL_RE =
  /\[POCKET_PAGE:\s*([a-z0-9][a-z0-9-]{2,79})\s*(?:\|\s*([^|\]]*))?(?:\|\s*([^\]]*))?\]/gi;
const POCKET_PAGE_URL_GLOBAL_RE =
  /(?:https?:\/\/[^\s<>()]+)?\/api\/pocket\/pages\/([a-z0-9][a-z0-9-]{2,79})(?![a-z0-9-])/gi;

export interface DetectedPocketPage {
  id: string;
  title: string;
  summary: string;
}

/**
 * Extracts `[POCKET_PAGE: id | Titel | Kurzbeschreibung]` references (as well as
 * fallback `/api/pocket/pages/<id>` URLs) emitted after `bin/publish-page`.
 */
export function extractPocketPages(text: string): DetectedPocketPage[] {
  const pages: DetectedPocketPage[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(POCKET_PAGE_GLOBAL_RE)) {
    const id = m[1].trim();
    if (seen.has(id)) continue;
    seen.add(id);
    pages.push({
      id,
      title: (m[2] || "").trim() || "Seite",
      summary: (m[3] || "").trim(),
    });
  }
  for (const m of text.matchAll(POCKET_PAGE_URL_GLOBAL_RE)) {
    const id = m[1].trim();
    if (seen.has(id)) continue;
    seen.add(id);
    const niceTitle = id
      .replace(/-\d{8}-[a-f0-9]{6}$/i, "")
      .replace(/-/g, " ")
      .replace(/^\w/, (c) => c.toUpperCase());
    pages.push({
      id,
      title: niceTitle || "Briefing & Seite",
      summary: "",
    });
  }
  return pages;
}

const ENV_VAR_CANDIDATE_RE =
  /\b([A-Z][A-Z0-9_]{2,48}_(?:API_KEY|TOKEN|SECRET|PASSWORD|PASSWD|KEY|PAT|AUTH))\b/g;

const ASKING_PHRASES_RE =
  /\b(gib mir|schick(?:e)? mir|sende mir|bitte .{0,40}(?:eingeben|angeben|senden|schicken|hinterlegen|bereitstellen|teilen|eintragen)|brauche (?:ich )?(?:noch )?(?:einen?|deinen?|den|das)|benötige (?:ich )?(?:noch )?(?:einen?|deinen?|den|das)|bitte trag|hinterlege|please provide|please enter|need (?:your|the|an?) .{0,30}(?:api|token|password|secret|key)|paste (?:your|the))\b/i;

const SECRET_NOUN_RE =
  /\b(api[- ]?key|api[- ]?token|api[- ]?schlüssel|access[- ]?token|bearer[- ]?token|long[- ]?lived[- ]?access[- ]?token|token|passwort|password|geheimnis|secret|zugangsdaten|app[- ]?passwort)\b/i;

const REFUSAL_OR_PAST_RE =
  /\b(würde ich nicht|nicht über einen normalen chat|erfolgreich gespeichert|wurde hinterlegt|bereits hinterlegt|karte gespeichert)\b/i;

function inferKeyFromContext(text: string): string {
  const lower = text.toLowerCase();
  if (/home\s*assist(?:ant|ent)|\bhass\b|\bha\b/.test(lower)) return "HASS_TOKEN";
  if (/fritz!?box/.test(lower)) return "FRITZBOX_PASSWORD";
  if (/pi-?hole/.test(lower)) return "PIHOLE_API_KEY";
  if (/github/.test(lower)) return "GITHUB_TOKEN";
  if (/cloudflare/.test(lower)) return "CLOUDFLARE_API_TOKEN";
  if (/telegram/.test(lower)) return "TELEGRAM_BOT_TOKEN";
  if (/discord/.test(lower)) return "DISCORD_TOKEN";
  if (/amazon/.test(lower)) return "AMAZON_PASSWORD";
  if (/paypal/.test(lower)) return "PAYPAL_PASSWORD";
  if (/imap|smtp|mail|e-?mail/.test(lower)) return "EMAIL_PASSWORD";
  if (/passwort|password/.test(lower)) return "SERVICE_PASSWORD";
  return "SERVICE_API_TOKEN";
}

/**
 * Returns true if the requested key is typically non-secret metadata (e.g. email,
 * username, URL, address) so the secure form can default to visible text while
 * still allowing masking and write-only storage in `.env`.
 */
export function isPlaintextFormFieldKey(keyName: string): boolean {
  const upper = keyName.trim().toUpperCase();
  if (/(?:^|_)(PASSWORD|PASSWD|SECRET|TOKEN|KEY|CVV|CVC|PIN|AUTH|CARD_NUMBER|CARD|IBAN)(?:$|_)/.test(upper)) {
    return false;
  }
  return /(?:^|_)(EMAIL|MAIL|USER|USERNAME|LOGIN|URL|HOST|NAME|ADDRESS|ADDR|STREET|CITY|ZIP|PLZ|PHONE|COUNTRY|EXPIRY|EXP)(?:$|_)/.test(
    upper
  );
}

/**
 * Detects an explicit or natural request to store a Payment Card, Shipping Address,
 * or Shop Login in Hermes's encrypted, model-blind Browser Vault (`vault.add`).
 */
export function detectBotVaultRequest(text: string): DetectedVaultRequest | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const tag = trimmed.match(EXPLICIT_VAULT_RE);
  if (tag) {
    const kind = tag[1].toLowerCase() as VaultItemKind;
    const defaultPrompt =
      kind === "payment"
        ? "Zahlungskarte verschlüsselt im Tresor speichern"
        : kind === "address"
          ? "Lieferadresse verschlüsselt im Tresor speichern"
          : "Shop-Zugangsdaten verschlüsselt im Tresor speichern";
    const origin = tag[3]?.trim() || undefined;
    return {
      kind,
      prompt: (tag[2] || defaultPrompt).trim(),
      origin,
      explicit: true,
    };
  }

  if (REFUSAL_OR_PAST_RE.test(trimmed)) return null;

  // Natural German fallback for checkout/vault prompts (e.g. "Zum Bezahlen fehlt mir noch eine Karte…")
  const asksForm =
    /\b(sichere[sn]? formular|tresor|vault|eintragen|hinterlegen|fehlt mir noch)\b/i.test(trimmed);
  if (!asksForm) return null;

  if (/\b(kreditkarte|zahlungskarte|debitkarte|visa|mastercard|karte)\b/i.test(trimmed) && /\b(bezahlen|kasse|bestellung|formular|tresor)\b/i.test(trimmed)) {
    return {
      kind: "payment",
      prompt: "Zahlungskarte verschlüsselt im Hermes-Tresor für den Browser-Checkout speichern.",
      explicit: false,
    };
  }
  if (/\b(lieferadresse|rechnungsadresse|anschrift)\b/i.test(trimmed) && /\b(formular|tresor|eintragen|hinterlegen)\b/i.test(trimmed)) {
    return {
      kind: "address",
      prompt: "Lieferadresse verschlüsselt im Hermes-Tresor für Bestellformulare speichern.",
      explicit: false,
    };
  }
  return null;
}

/**
 * Extracts structured `[DEAL_CARD: Shop | Title | Price | OldPrice | URL | ImageURL]` product cards
 * from an assistant message so Hermes Pocket renders swipeable deal cards with thumbnails & "Jetzt kaufen".
 */
export function extractProductDeals(text: string): DetectedDealCard[] {
  const deals: DetectedDealCard[] = [];
  for (const m of text.matchAll(EXPLICIT_DEAL_GLOBAL_RE)) {
    const shop = (m[1] || "").trim();
    const title = (m[2] || "").trim();
    const price = (m[3] || "").trim();
    const col4 = (m[4] || "").trim();
    const col5 = (m[5] || "").trim();
    const col6 = (m[6] || "").trim();
    // Support 4-col (Shop|Title|Price|URL), 5-col (Shop|Title|Price|OldPrice|URL or ...|URL|ImageURL),
    // and 6-col (Shop|Title|Price|OldPrice|URL|ImageURL)
    let oldPrice: string | undefined;
    let url = "";
    let imageUrl: string | undefined;

    if (col6) {
      if (col4) oldPrice = col4;
      url = col5;
      imageUrl = col6;
    } else if (col5) {
      if (/^https?:\/\//i.test(col4) && /^https?:\/\//i.test(col5)) {
        url = col4;
        imageUrl = col5;
      } else {
        if (col4) oldPrice = col4;
        url = col5;
      }
    } else if (col4) {
      if (/^https?:\/\//i.test(col4)) {
        url = col4;
      } else {
        oldPrice = col4;
      }
    }

    if (!shop || !title || !price) continue;
    if (url && !/^https?:\/\//i.test(url)) url = "";
    if (imageUrl && !/^https?:\/\//i.test(imageUrl)) imageUrl = undefined;
    deals.push({
      shop,
      title,
      price,
      ...(oldPrice ? { oldPrice } : {}),
      url,
      ...(imageUrl ? { imageUrl } : {}),
    });
  }
  return deals;
}

function normalizeKnownServiceKey(rawKey: string, contextText: string): string {
  const upper = rawKey.trim().toUpperCase();
  const lowerCtx = contextText.toLowerCase();
  const mentionsHass = /home\s*assist(?:ant|ent)|\bhass\b|\bha[-_\s]token\b/.test(lowerCtx);
  if (
    mentionsHass &&
    (upper === "SERVICE_TOKEN" ||
      upper === "SERVICE_API_TOKEN" ||
      upper === "HOME_ASSISTANT_TOKEN" ||
      upper === "HA_TOKEN" ||
      upper === "HASS_API_TOKEN")
  ) {
    return "HASS_TOKEN";
  }
  if (
    mentionsHass &&
    (upper === "SERVICE_URL" || upper === "HOME_ASSISTANT_URL" || upper === "HA_URL")
  ) {
    return "HASS_URL";
  }
  return upper;
}

/**
 * Inspects a completed bot message and extracts either a single secure field or a
 * complete multi-field secure form (`[SECRET_FORM: ...]` + multiple `[SECRET_REQUEST: ...]`).
 */
export function detectBotSecretForm(text: string): DetectedSecretForm | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  // Prefer native encrypted Hermes Vault form when a vault request is present
  if (EXPLICIT_VAULT_RE.test(trimmed)) {
    return null;
  }

  const explicitMatches = Array.from(trimmed.matchAll(EXPLICIT_TAG_GLOBAL_RE));
  if (explicitMatches.length > 0) {
    const seen = new Set<string>();
    const fields: DetectedSecretRequest[] = [];
    for (const m of explicitMatches) {
      const promptText = (m[2] || "").trim();
      const keyName = normalizeKnownServiceKey(m[1], `${trimmed} ${promptText}`);
      if (seen.has(keyName)) continue;
      seen.add(keyName);
      fields.push({
        keyName,
        prompt: promptText || `Bitte gib den Wert für ${keyName} sicher ein.`,
        explicit: true,
      });
    }
    const titleMatch = trimmed.match(EXPLICIT_FORM_TITLE_RE);
    const title =
      titleMatch?.[1]?.trim() ||
      (fields.length > 1 ? "Gesichertes Formular" : "Passwort / API-Key sicher eingeben");
    return {
      title,
      fields,
      explicit: true,
    };
  }

  // Natural language fallback (single field)
  if (REFUSAL_OR_PAST_RE.test(trimmed)) {
    return null;
  }

  const envMatches = Array.from(trimmed.matchAll(ENV_VAR_CANDIDATE_RE)).map((m) => m[1]);
  if ((!SECRET_NOUN_RE.test(trimmed) && envMatches.length === 0) || !ASKING_PHRASES_RE.test(trimmed)) {
    return null;
  }

  const keyName = envMatches[0] || inferKeyFromContext(trimmed);
  return {
    title: "Passwort / API-Key sicher eingeben",
    fields: [
      {
        keyName,
        prompt: `Sichere Eingabe für ${keyName} – wird direkt in der geschützten .env des Bots gespeichert.`,
        explicit: false,
      },
    ],
    explicit: false,
  };
}

/**
 * Backward-compatible single-field helper returning the first detected secret request.
 */
export function detectBotSecretRequest(text: string): DetectedSecretRequest | null {
  const form = detectBotSecretForm(text);
  return form?.fields[0] ?? null;
}

export interface DetectedChecklist {
  id: string;
  title: string;
  items: Array<{ text: string; checked: boolean }>;
}

export interface DetectedPackageCard {
  shop: string;
  product: string;
  status: string;
  eta?: string;
  carrier: string;
  orderNumber?: string;
  trackingNumber?: string;
  trackingUrl?: string;
  progress: number; // 20 | 50 | 80 | 100
}

const CHECKLIST_TAG_GLOBAL_RE = /\[CHECKLIST:\s*([^\]]+)\]/gi;
const PACKAGE_CARD_GLOBAL_RE = /\[PACKAGE_CARD:\s*([^\]]+)\]/gi;
const REACT_TAG_GLOBAL_RE = /\[REACT:\s*([^\]]+)\]/gi;

/**
 * Extracts emoji reactions emitted by a bot as `[REACT: 👍]` (to attach
 * directly onto the user's preceding message bubble).
 */
export function extractBotReactions(text: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  for (const m of text.matchAll(REACT_TAG_GLOBAL_RE)) {
    const emoji = m[1].trim().slice(0, 8);
    if (emoji && !out.includes(emoji)) out.push(emoji);
  }
  return out;
}

export function buildCarrierTrackingUrl(carrier: string, trackingNumber?: string): string | undefined {
  const num = (trackingNumber || "").trim();
  if (!num) return undefined;
  const c = carrier.trim().toLowerCase();
  const enc = encodeURIComponent(num);
  if (c.includes("dhl")) {
    return `https://www.dhl.de/de/privatkunden/pakete-empfangen/verfolgen.html?piececode=${enc}`;
  }
  if (c.includes("dpd")) {
    return `https://tracking.dpd.de/status/de_DE/parcel/${enc}`;
  }
  if (c.includes("hermes")) {
    return `https://www.myhermes.de/empfangen/sendungsverfolgung/sendungsinformation/#${enc}`;
  }
  if (c.includes("gls")) {
    return `https://www.gls-pakete.de/sendungsverfolgung?match=${enc}`;
  }
  if (c.includes("ups")) {
    return `https://www.ups.com/track?loc=de_DE&tracknum=${enc}`;
  }
  if (c.includes("post")) {
    return `https://www.deutschepost.de/de/s/sendungsverfolgung.html?piececode=${enc}`;
  }
  return undefined;
}

function inferPackageProgress(status: string): number {
  const s = status.trim().toLowerCase();
  if (/zugestellt|delivered|abgeholt|empfangen/.test(s)) return 100;
  if (/zustellung|out for delivery|heute|zustellfahrzeug/.test(s)) return 80;
  if (/versandt|unterwegs|shipped|transit|übergeben|paketzentrum/.test(s)) return 52;
  return 20;
}

/**
 * Extracts package delivery tracking cards emitted as:
 * `[PACKAGE_CARD: Shop | Produkt | Status | Ankunft | Paketdienst | Bestellnummer | Sendungsnummer | TrackingURL]`
 */
export function extractPackageCards(text: string): DetectedPackageCard[] {
  if (!text) return [];
  const out: DetectedPackageCard[] = [];
  for (const m of text.matchAll(PACKAGE_CARD_GLOBAL_RE)) {
    const parts = m[1].split("|").map((p) => p.trim());
    if (parts.length < 3) continue;
    const [shop, product, status, etaRaw, carrierRaw, orderRaw, trackingRaw, urlRaw] = parts;
    if (!shop || !product || !status) continue;
    const carrier = carrierRaw || "Paketdienst";
    const trackingNumber = trackingRaw && trackingRaw !== "-" ? trackingRaw : undefined;
    const explicitUrl = urlRaw && /^https?:\/\//i.test(urlRaw) ? urlRaw : undefined;
    const trackingUrl = explicitUrl || buildCarrierTrackingUrl(carrier, trackingNumber);
    out.push({
      shop,
      product,
      status,
      ...(etaRaw && etaRaw !== "-" ? { eta: etaRaw } : {}),
      carrier,
      ...(orderRaw && orderRaw !== "-" ? { orderNumber: orderRaw } : {}),
      ...(trackingNumber ? { trackingNumber } : {}),
      ...(trackingUrl ? { trackingUrl } : {}),
      progress: inferPackageProgress(status),
    });
  }
  return out;
}

function slugifyChecklistId(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return base.length >= 2 ? `cl-${base}` : "cl-liste";
}

/**
 * Extracts interactive checklists emitted as:
 * `[CHECKLIST: Einkaufsliste | Milch | [x] Kaffee | Brot]`
 */
export function extractChecklists(text: string): DetectedChecklist[] {
  if (!text) return [];
  const out: DetectedChecklist[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(CHECKLIST_TAG_GLOBAL_RE)) {
    const parts = m[1]
      .split("|")
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length < 2) continue;
    const title = parts[0];
    const id = slugifyChecklistId(title);
    if (seen.has(id)) continue;
    seen.add(id);
    const items = parts.slice(1).map((raw) => {
      const checkedMatch = raw.match(/^\[(x|X|✓)\]\s*(.+)$/);
      if (checkedMatch) {
        return { text: checkedMatch[2].trim(), checked: true };
      }
      const uncheckedMatch = raw.match(/^\[\s*\]\s*(.+)$/);
      if (uncheckedMatch) {
        return { text: uncheckedMatch[1].trim(), checked: false };
      }
      return { text: raw, checked: false };
    });
    if (items.length > 0) {
      out.push({ id, title, items });
    }
  }
  return out;
}

export interface ParsedCronjobMessage {
  jobName: string;
  body: string;
}

export interface DetectedChoiceCard {
  question: string;
  choices: string[];
  isExplicit: boolean;
}

const CHOICE_CARD_GLOBAL_RE = /\[CHOICE_CARD:\s*([^\]]+)\]/gi;

/**
 * Cleans Hermes's built-in `Cronjob Response: <Name> (job_id: ...)` wrapper
 * delivered into `Bot Chat` so it renders as a sleek routine message without
 * raw technical headers or English management footers.
 */
export function parseCronjobResponseMessage(text: string): ParsedCronjobMessage | null {
  if (!text) return null;
  const trimmed = text.trim();
  const headerMatch = trimmed.match(
    /^Cronjob Response:\s*([^\r\n]+)\r?\n(?:\(job_id:\s*[^)]+\)\r?\n)?[-─]{3,}\s*\r?\n+([\s\S]+)$/i
  );
  if (!headerMatch) return null;
  const jobName = headerMatch[1].trim();
  const body = headerMatch[2]
    .replace(/\r?\n*To stop or manage this job,[\s\S]*$/i, "")
    .trim();
  if (!body) return null;
  return { jobName, body };
}

/**
 * Extracts an interactive Multiple-Choice / Quick-Reply card from a bot message:
 * 1. Explicit `[CHOICE_CARD: Frage | Option 1 | Option 2 | ...]` tag (works in any chat or cronjob).
 * 2. When `allowSmartAutoDetect` is true (latest unanswered bot/cronjob message), detects direct
 *    German decision questions (e.g. "Soll ich ... übernehmen?") and builds 1-tap reply choices.
 */
export function extractInlineChoiceCard(
  text: string,
  allowSmartAutoDetect = false
): DetectedChoiceCard | null {
  if (!text) return null;

  for (const m of text.matchAll(CHOICE_CARD_GLOBAL_RE)) {
    const parts = m[1]
      .split("|")
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length >= 2) {
      return {
        question: parts[0],
        choices: parts.slice(1, 6),
        isExplicit: true,
      };
    }
  }

  if (!allowSmartAutoDetect) return null;

  const cron = parseCronjobResponseMessage(text);
  const cleanBody = stripSecretRequestTag(cron ? cron.body : text);
  if (!cleanBody || cleanBody.length > 1200) return null;

  // Match a direct German decision question sentence ending with "?"
  const sentences = cleanBody
    .split(/(?<=[?!.])\s+|\r?\n+/)
    .map((s) => s.replace(/[*_`]+/g, "").trim())
    .filter(Boolean);

  const capitalizeOption = (raw: string): string => {
    const clean = raw.replace(/[?.!,;:]+$/, "").trim();
    if (!clean) return "";
    return clean.charAt(0).toUpperCase() + clean.slice(1);
  };

  // 1. Check for explicit "A oder B?" alternative questions (e.g.
  //    "Was möchtest du damit machen – den Inhalt erklärt bekommen oder das Video herunterladen?")
  for (const s of sentences) {
    if (!s.endsWith("?") || s.length < 14 || s.length > 240) continue;
    const altMatch = s.match(/(?:[–—:]\s*)([^?–—:]{3,70}?)\s+oder\s+([^?–—:]{3,70}?)\?$/i);
    if (altMatch) {
      const optA = capitalizeOption(altMatch[1]);
      const optB = capitalizeOption(altMatch[2]);
      if (optA.length >= 3 && optB.length >= 3 && optA.toLowerCase() !== optB.toLowerCase()) {
        return {
          question: s,
          choices: [optA, optB],
          isExplicit: false,
        };
      }
    }
  }

  // 2. Check for true Yes/No decision questions — strictly skip open W-questions
  //    ("Was möchtest du...", "Welche...", "Wie...", etc.) so they never get "Ja / Nein"
  const OPEN_W_QUESTION_RE = /^(?:was|welche[rsnm]?|wie|wo|wohin|woher|wann|wer|wen|wem|warum|weshalb|wieso|wofür|womit)\b/i;
  const YES_NO_QUESTION_RE =
    /^(?:(?:hi|hallo|hey)\s+[^,!?]{1,24}[,!]\s*)?(?:soll ich|möchtest du|willst du|darf ich|kann ich|wollen wir|sollen wir|passt das|einverstanden)\b/i;

  const decisionQuestion = sentences.find(
    (s) =>
      s.endsWith("?") &&
      s.length >= 12 &&
      s.length <= 220 &&
      !OPEN_W_QUESTION_RE.test(s) &&
      !/\boder\b/i.test(s) &&
      YES_NO_QUESTION_RE.test(s)
  );
  if (!decisionQuestion) return null;

  const lower = decisionQuestion.toLowerCase();
  if (/übernehmen|ändern|anpassen|einstellen|speichern|aktivieren|heizplan/.test(lower)) {
    return {
      question: decisionQuestion,
      choices: ["Ja, übernehmen", "Nein, nicht ändern"],
      isExplicit: false,
    };
  }
  if (/bestellen|kaufen|buchen|senden|abschicken|löschen|ausführen/.test(lower)) {
    return {
      question: decisionQuestion,
      choices: ["Ja, mach das", "Nein, abbrechen"],
      isExplicit: false,
    };
  }
  return {
    question: decisionQuestion,
    choices: ["Ja, bitte", "Nein, danke"],
    isExplicit: false,
  };
}

/**
 * Strips any internal `[SECRET_FORM: ...]`, `[SECRET_REQUEST: ...]`, `[VAULT_REQUEST: ...]`,
 * `[DEAL_CARD: ...]`, `[POCKET_PAGE: ...]`, `[CHECKLIST: ...]`, and `[CHOICE_CARD: ...]` directives from rendered markdown prose.
 */
export function stripSecretRequestTag(text: string): string {
  return text
    .replace(EXPLICIT_FORM_TITLE_GLOBAL_RE, "")
    .replace(EXPLICIT_TAG_GLOBAL_RE, "")
    .replace(EXPLICIT_VAULT_GLOBAL_RE, "")
    .replace(CHECKLIST_TAG_GLOBAL_RE, "")
    .replace(CHOICE_CARD_GLOBAL_RE, "")
    .replace(PACKAGE_CARD_GLOBAL_RE, "")
    .replace(REACT_TAG_GLOBAL_RE, "")
    .replace(EXPLICIT_DEAL_GLOBAL_RE, "")
    .replace(POCKET_PAGE_GLOBAL_RE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
