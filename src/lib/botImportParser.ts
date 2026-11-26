/**
 * Clean, user-driven Bot Import parser for migrating a bot's role, instructions,
 * exported memories, and optional routine drafts (always imported PAUSED) into Hermes.
 */

export interface ImportedRoutineDraft {
  name: string;
  schedule: string;
  prompt: string;
}

export interface ParsedBotImport {
  name: string;
  slug: string;
  description: string;
  soul: string;
  memories: string[];
  routines: ImportedRoutineDraft[];
  integrations: string[];
  format: "json" | "text";
}

export const GROKBOT_EXPORT_PROMPT = `Bitte erstelle einen sauberen Export deiner Rolle und deiner Erinnerungen für den Umzug in meinen privaten Hermes-Agenten.
Gib die Antwort bitte als JSON-Block zurück (ohne Passwörter, Tokens oder Zugangsdaten):

\`\`\`json
{
  "name": "Dein Bot-Name",
  "description": "Kurze Rollenbeschreibung in einem Satz",
  "soul": "Ausführliche Beschreibung deiner Persönlichkeit, deines Tonfalls, deiner Aufgaben und Regeln",
  "memories": [
    "Wichtige dauerhafte Erinnerung oder Präferenz 1",
    "Wichtige dauerhafte Erinnerung oder Präferenz 2"
  ],
  "routines": [
    {
      "name": "Name einer wiederkehrenden Aufgabe (optional)",
      "schedule": "z. B. täglich 09:00 Europe/Berlin",
      "prompt": "Was die Routine tun soll"
    }
  ],
  "integrations": [
    "Welche Dienste du brauchst, z. B. Gmail, Kalender (nur Namen, keine Zugangsdaten)"
  ]
}
\`\`\``;

export function slugifyBotName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

function extractJsonBlock(raw: string): string | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) return fenced[1].trim();
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return raw.slice(firstBrace, lastBrace + 1).trim();
  }
  return null;
}

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (item && typeof item === "object") {
        const obj = item as Record<string, unknown>;
        return String(obj.text ?? obj.fact ?? obj.memory ?? obj.name ?? "").trim();
      }
      return "";
    })
    .filter(Boolean);
}

function toRoutineList(value: unknown): ImportedRoutineDraft[] {
  if (!Array.isArray(value)) return [];
  const out: ImportedRoutineDraft[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const name = String(obj.name || obj.title || "").trim();
    const schedule = String(obj.schedule || obj.cron || obj.time || "").trim();
    const prompt = String(obj.prompt || obj.task || obj.description || "").trim();
    if (name || prompt) {
      out.push({
        name: name || "Importierte Routine",
        schedule: schedule || "09:00 täglich",
        prompt: prompt || name,
      });
    }
  }
  return out;
}

export function parseBotImportText(rawInput: string): ParsedBotImport | null {
  const text = rawInput.trim();
  if (!text) return null;

  const jsonCandidate = extractJsonBlock(text);
  if (jsonCandidate) {
    try {
      const obj = JSON.parse(jsonCandidate) as Record<string, unknown>;
      if (obj && typeof obj === "object" && !Array.isArray(obj)) {
        const name = String(obj.name || obj.bot_name || obj.title || "").trim();
        const description = String(obj.description || obj.role || obj.summary || "").trim();
        const soul = String(
          obj.soul || obj.instructions || obj.system_prompt || obj.personality || ""
        ).trim();
        const memories = toStringList(obj.memories ?? obj.memory ?? obj.facts);
        const routines = toRoutineList(obj.routines ?? obj.schedules ?? obj.cron);
        const integrations = toStringList(obj.integrations ?? obj.connectors ?? obj.tools);

        if (name || description || soul || memories.length > 0) {
          return {
            name: name || "Importierter Bot",
            slug: slugifyBotName(name || "import-bot"),
            description,
            soul,
            memories,
            routines,
            integrations,
            format: "json",
          };
        }
      }
    } catch {
      // Fall through to free-text / Markdown parsing
    }
  }

  // Fallback: free-text / Markdown export parsing
  const lines = text.split(/\r?\n/);
  const heading = lines.find((l) => /^#{1,3}\s+/.test(l.trim()));
  const nameLine = lines.find((l) => /^(name|bot)\s*:/i.test(l.trim()));
  const descLine = lines.find((l) => /^(rolle|beschreibung|description|aufgabe)\s*:/i.test(l.trim()));

  const extractedName = nameLine
    ? nameLine.replace(/^(name|bot)\s*:\s*/i, "").trim()
    : heading
      ? heading.replace(/^#{1,3}\s+/, "").trim()
      : "";

  const extractedDesc = descLine
    ? descLine.replace(/^(rolle|beschreibung|description|aufgabe)\s*:\s*/i, "").trim()
    : "";

  return {
    name: extractedName || "Importierter Bot",
    slug: slugifyBotName(extractedName || "import-bot"),
    description: extractedDesc,
    soul: text,
    memories: [],
    routines: [],
    integrations: [],
    format: "text",
  };
}

/**
 * Builds a clean Hermes SOUL.md document combining the bot's personality,
 * exported memories, and optional integration notes (never secrets).
 */
export function buildHermesSoulDocument(parsed: ParsedBotImport): string {
  const sections: string[] = [];
  sections.push(`# ${parsed.name}`);

  if (parsed.description) {
    sections.push(parsed.description);
  }

  if (parsed.soul) {
    sections.push(parsed.soul);
  }

  if (parsed.memories.length > 0) {
    sections.push(
      `## Importierte Erinnerungen\n${parsed.memories.map((m) => `- ${m}`).join("\n")}`
    );
  }

  if (parsed.integrations.length > 0) {
    sections.push(
      `## Benötigte Integrationen (in Hermes verbinden)\n${parsed.integrations
        .map((i) => `- ${i}`)
        .join("\n")}`
    );
  }

  if (parsed.routines.length > 0) {
    sections.push(
      `## Importierte Routinen-Entwürfe (Standardmäßig pausiert)\n${parsed.routines
        .map((r) => `- **${r.name}** (${r.schedule}): ${r.prompt}`)
        .join("\n")}`
    );
  }

  return sections.join("\n\n").trim();
}
