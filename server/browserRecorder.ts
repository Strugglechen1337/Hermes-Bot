import { WebSocket } from "ws";

/**
 * "Teach a task": records what the user does in a bot's live browser (clicks, typed text, page
 * changes) over CDP, so the bot can turn it into a reusable skill. Secrets are never recorded:
 * values of password / one-time-code / card fields are replaced by a placeholder inside the
 * page itself, before anything leaves the browser.
 */

export interface RecordedStep {
  t: number;
  kind: "open" | "click" | "type" | "key";
  url?: string;
  target?: string;
  value?: string;
  secret?: boolean;
}

const MAX_STEPS = 300;
const MAX_MS = 10 * 60 * 1000;
const BINDING = "hpRecord";

/** Injected into every page (and re-injected on navigation). Runs in the browser. */
export const RECORDER_SCRIPT = `(() => {
  if (window.__hpRecInstalled) return;
  window.__hpRecInstalled = true;
  const send = (o) => { try { window.${BINDING}(JSON.stringify(o)); } catch (e) {} };
  const SECRET_RE = /pass|pwd|otp|one-time|code|cvv|cvc|card|iban|pin|token|secret|auth/i;
  const isSecret = (el) => {
    if (!el || el.tagName !== "INPUT" && el.tagName !== "TEXTAREA") return false;
    const attrs = [el.type, el.name, el.id, el.autocomplete, el.getAttribute("aria-label"), el.placeholder].join(" ");
    return el.type === "password" || SECRET_RE.test(attrs);
  };
  const describe = (el) => {
    if (!el || !el.tagName) return "";
    const tag = el.tagName.toLowerCase();
    const text = (el.getAttribute("aria-label") || el.innerText || el.value || el.placeholder || el.alt || el.title || "")
      .replace(/\\s+/g, " ").trim().slice(0, 60);
    const bits = [tag];
    if (el.id) bits.push("#" + el.id);
    if (el.name) bits.push("[name=" + el.name + "]");
    if (el.type && tag === "input") bits.push("[type=" + el.type + "]");
    if (text && !isSecret(el)) bits.push('"' + text + '"');
    return bits.join(" ");
  };
  document.addEventListener("click", (e) => {
    const el = e.target && e.target.closest ? (e.target.closest("a,button,input,select,label,[role=button]") || e.target) : e.target;
    send({ kind: "click", target: describe(el), url: location.href });
  }, true);
  document.addEventListener("change", (e) => {
    const el = e.target;
    if (!el || !el.tagName) return;
    const secret = isSecret(el);
    send({ kind: "type", target: describe(el), value: secret ? "" : String(el.value || "").slice(0, 200), secret, url: location.href });
  }, true);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === "Escape" || e.key === "Tab") {
      send({ kind: "key", value: e.key, target: describe(e.target), secret: isSecret(e.target), url: location.href });
    }
  }, true);
})();`;

interface CdpTarget {
  id?: string;
  type?: string;
  url?: string;
  webSocketDebuggerUrl?: string;
}

class Recording {
  steps: RecordedStep[] = [];
  readonly startedAt = Date.now();
  private sockets = new Map<string, WebSocket>();
  private lastUrl = new Map<string, string>();
  private timer: NodeJS.Timeout;
  private stopped = false;

  constructor(private readonly cdpPort: number) {
    void this.scan();
    this.timer = setInterval(() => {
      if (Date.now() - this.startedAt > MAX_MS) this.stop();
      else void this.scan();
    }, 2000);
  }

  private push(step: Omit<RecordedStep, "t">) {
    if (this.steps.length >= MAX_STEPS || this.stopped) return;
    this.steps.push({ t: Math.round((Date.now() - this.startedAt) / 1000), ...step });
  }

  private async scan() {
    try {
      const res = await fetch(`http://127.0.0.1:${this.cdpPort}/json/list`);
      const targets = (await res.json()) as CdpTarget[];
      for (const t of targets) {
        if (t.type !== "page" || !t.id || !t.webSocketDebuggerUrl || this.sockets.has(t.id)) continue;
        this.attach(t);
      }
    } catch {
      // browser unreachable – try again next tick
    }
  }

  private attach(t: CdpTarget) {
    const id = t.id as string;
    const ws = new WebSocket(t.webSocketDebuggerUrl as string);
    this.sockets.set(id, ws);
    let n = 0;
    const call = (method: string, params: Record<string, unknown> = {}) =>
      ws.send(JSON.stringify({ id: ++n, method, params }));
    ws.on("open", () => {
      call("Page.enable");
      call("Runtime.enable");
      call("Runtime.addBinding", { name: BINDING });
      call("Page.addScriptToEvaluateOnNewDocument", { source: RECORDER_SCRIPT });
      call("Runtime.evaluate", { expression: RECORDER_SCRIPT });
    });
    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(String(raw)) as {
          method?: string;
          params?: { name?: string; payload?: string; frame?: { url?: string; parentId?: string } };
        };
        if (msg.method === "Runtime.bindingCalled" && msg.params?.name === BINDING && msg.params.payload) {
          const o = JSON.parse(msg.params.payload) as RecordedStep;
          this.push({
            kind: o.kind,
            target: o.target,
            value: o.secret ? undefined : o.value,
            secret: o.secret || undefined,
            url: o.url,
          });
        } else if (msg.method === "Page.frameNavigated" && msg.params?.frame && !msg.params.frame.parentId) {
          const url = msg.params.frame.url || "";
          if (url && url !== this.lastUrl.get(id) && url.startsWith("http")) {
            this.lastUrl.set(id, url);
            this.push({ kind: "open", url });
          }
        }
      } catch {
        // ignore malformed events
      }
    });
    const drop = () => this.sockets.delete(id);
    ws.on("close", drop);
    ws.on("error", drop);
  }

  stop(): RecordedStep[] {
    this.stopped = true;
    clearInterval(this.timer);
    for (const ws of this.sockets.values()) {
      try {
        ws.close();
      } catch {
        // already closed
      }
    }
    this.sockets.clear();
    return this.steps;
  }
}

const active = new Map<number, Recording>();

export function startRecording(cdpPort: number): void {
  active.get(cdpPort)?.stop();
  active.set(cdpPort, new Recording(cdpPort));
}

export function isRecording(cdpPort: number): boolean {
  return active.has(cdpPort);
}

export function stopRecording(cdpPort: number): RecordedStep[] {
  const rec = active.get(cdpPort);
  active.delete(cdpPort);
  return rec ? rec.stop() : [];
}

/** Turns the raw steps into compact numbered text lines (consecutive duplicates dropped). */
export function formatSteps(steps: RecordedStep[]): string {
  const lines: string[] = [];
  let last = "";
  for (const s of steps) {
    let line = "";
    if (s.kind === "open") line = `Seite geöffnet: ${s.url}`;
    else if (s.kind === "click") line = `Geklickt: ${s.target}`;
    else if (s.kind === "type")
      line = s.secret
        ? `Geheimes Feld ausgefüllt (${s.target}) – Wert NICHT aufgezeichnet: zur Laufzeit Tresor (browser_vault) nutzen oder den Nutzer fragen`
        : `Eingegeben in ${s.target}: "${s.value}"`;
    else if (s.kind === "key") line = s.secret ? "" : `Taste ${s.value} in ${s.target}`;
    if (!line || line === last) continue;
    last = line;
    lines.push(line);
  }
  return lines.map((l, i) => `${i + 1}. ${l}`).join("\n");
}
