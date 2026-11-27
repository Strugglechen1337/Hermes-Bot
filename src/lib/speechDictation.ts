/**
 * Reliable German Web Speech dictation controller for iOS Safari / Standalone PWA
 * and desktop browsers.
 *
 * Key iOS WebKit workarounds:
 * - Never detach `onend` when stopping; instead use a generation counter so late
 *   `onresult` events after sending are ignored while `isRunning` still resets cleanly.
 * - Never call `abort()` (which wedges iOS SFSpeechRecognizer on subsequent starts).
 * - If `start()` is tapped while the previous session is still winding down, wait
 *   for `onend` + 120ms before starting the next session cleanly.
 * - Startup watchdog resets stuck state if iOS silently drops `onstart`/`onend`.
 */

interface BrowserSpeechRecognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onstart: (() => void) | null;
  onresult: ((ev: { results: ArrayLike<{ isFinal?: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((ev: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

type SpeechRecCtor = new () => BrowserSpeechRecognition;

function getSpeechRecognitionCtor(): SpeechRecCtor | null {
  if (typeof window === "undefined") return null;
  const win = window as unknown as {
    SpeechRecognition?: SpeechRecCtor;
    webkitSpeechRecognition?: SpeechRecCtor;
  };
  return win.SpeechRecognition || win.webkitSpeechRecognition || null;
}

export function isSpeechDictationSupported(): boolean {
  return Boolean(getSpeechRecognitionCtor());
}

export interface DictationCallbacks {
  baseText: string;
  onTranscript: (fullText: string) => void;
  onStateChange: (active: boolean) => void;
  onError?: (message: string) => void;
}

class DictationController {
  private rec: BrowserSpeechRecognition | null = null;
  private isRunning = false;
  private isStopping = false;
  private gen = 0;
  private activeCallbacks: DictationCallbacks | null = null;
  private pendingStart: DictationCallbacks | null = null;
  private startWatchdog: number | null = null;

  private clearWatchdog() {
    if (this.startWatchdog !== null) {
      window.clearTimeout(this.startWatchdog);
      this.startWatchdog = null;
    }
  }

  private ensureInstance(): BrowserSpeechRecognition | null {
    if (this.rec) return this.rec;
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return null;
    const rec = new Ctor();
    rec.lang = "de-DE";
    rec.interimResults = true;
    rec.continuous = false;
    this.rec = rec;
    return rec;
  }

  public isActive(): boolean {
    return this.isRunning && !this.isStopping;
  }

  public start(callbacks: DictationCallbacks): boolean {
    const rec = this.ensureInstance();
    if (!rec) return false;

    // If a previous session is still tearing down on iOS, queue this start for onend
    if (this.isRunning || this.isStopping) {
      this.pendingStart = callbacks;
      this.stop(true);
      return true;
    }

    this.beginSession(rec, callbacks);
    return true;
  }

  private beginSession(rec: BrowserSpeechRecognition, callbacks: DictationCallbacks) {
    const myGen = ++this.gen;
    this.activeCallbacks = callbacks;
    this.isStopping = false;
    this.isRunning = true;
    const base = callbacks.baseText.trim();

    this.clearWatchdog();
    let started = false;
    this.startWatchdog = window.setTimeout(() => {
      if (!started && this.gen === myGen) {
        // iOS silently wedged the instance; discard it so the next tap gets a fresh one
        this.isRunning = false;
        this.isStopping = false;
        this.rec = null;
        this.activeCallbacks?.onStateChange(false);
        this.activeCallbacks = null;
      }
    }, 3500);

    rec.onstart = () => {
      if (this.gen !== myGen) return;
      started = true;
      this.clearWatchdog();
      callbacks.onStateChange(true);
    };

    rec.onresult = (ev) => {
      if (this.gen !== myGen || this.isStopping) return;
      started = true;
      this.clearWatchdog();
      let transcript = "";
      for (let i = 0; i < ev.results.length; i++) {
        transcript += ev.results[i][0]?.transcript || "";
      }
      const clean = transcript.trim();
      if (!clean) return;
      callbacks.onTranscript(base ? `${base} ${clean}` : clean);
    };

    rec.onerror = (ev) => {
      if (this.gen !== myGen) return;
      this.clearWatchdog();
      const code = ev?.error || "";
      if (code === "not-allowed" || code === "service-not-allowed") {
        callbacks.onError?.(
          "Mikrofonzugriff abgelehnt (iPhone Einstellungen → Safari → Mikrofon → Erlauben)."
        );
      } else if (code && code !== "no-speech" && code !== "aborted") {
        // Discard potentially wedged instance on unexpected WebKit errors
        this.rec = null;
      }
    };

    rec.onend = () => {
      this.clearWatchdog();
      this.isRunning = false;
      this.isStopping = false;
      if (this.gen === myGen) {
        callbacks.onStateChange(false);
        this.activeCallbacks = null;
      }
      const queued = this.pendingStart;
      this.pendingStart = null;
      if (queued) {
        window.setTimeout(() => {
          const nextRec = this.ensureInstance();
          if (nextRec && !this.isRunning) {
            this.beginSession(nextRec, queued);
          }
        }, 140);
      }
    };

    try {
      callbacks.onStateChange(true);
      rec.start();
    } catch {
      this.clearWatchdog();
      this.isRunning = false;
      this.isStopping = false;
      this.rec = null;
      callbacks.onStateChange(false);
      this.activeCallbacks = null;
    }
  }

  public stop(keepPending = false): void {
    this.gen += 1;
    if (!keepPending) {
      this.pendingStart = null;
    }
    this.clearWatchdog();
    const prevCb = this.activeCallbacks;
    this.activeCallbacks = null;
    prevCb?.onStateChange(false);

    if (this.rec && this.isRunning) {
      this.isStopping = true;
      try {
        this.rec.stop();
      } catch {
        this.isRunning = false;
        this.isStopping = false;
        this.rec = null;
      }
    }
  }
}

export const speechDictation = new DictationController();
