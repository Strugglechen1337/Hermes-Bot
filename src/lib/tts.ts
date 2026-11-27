/**
 * Lightweight browser Web Speech API (TTS) helper for reading bot replies aloud
 * in German, stripping markdown & internal card/media tags first.
 */

let currentlySpeakingKey: string | null = null;
const listeners = new Set<(activeKey: string | null) => void>();

function notify(key: string | null): void {
  currentlySpeakingKey = key;
  for (const fn of listeners) {
    fn(key);
  }
}

export function isTtsSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    typeof SpeechSynthesisUtterance !== "undefined"
  );
}

export function subscribeTtsState(cb: (activeKey: string | null) => void): () => void {
  listeners.add(cb);
  cb(currentlySpeakingKey);
  return () => {
    listeners.delete(cb);
  };
}

export function stopSpeaking(): void {
  if (!isTtsSupported()) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    // ignore
  }
  notify(null);
}

export function cleanTextForSpeech(raw: string): string {
  return (raw || "")
    .replace(/\[(?:POCKET_PAGE|PACKAGE_CARD|DEAL_CARD|SECRET_REQUEST|CHECKLIST|REACT):[^\]]*\]/gi, " ")
    .replace(/`?MEDIA:\s*\/[^\s`<>()[\]"']+`?/gi, " ")
    .replace(/```[\s\S]*?```/g, " Codeblock ")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/[^\s]+/g, "")
    .replace(/[*_~`#>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function toggleSpeakText(key: string, rawText: string): boolean {
  if (!isTtsSupported()) return false;
  if (currentlySpeakingKey === key) {
    stopSpeaking();
    return false;
  }
  stopSpeaking();

  const spoken = cleanTextForSpeech(rawText);
  if (!spoken) return false;

  const utterance = new SpeechSynthesisUtterance(spoken.slice(0, 3000));
  utterance.lang = "de-DE";
  utterance.rate = 1.03;

  try {
    const voices = window.speechSynthesis.getVoices();
    const deVoice =
      voices.find((v) => v.lang.toLowerCase().startsWith("de") && v.localService) ||
      voices.find((v) => v.lang.toLowerCase().startsWith("de"));
    if (deVoice) utterance.voice = deVoice;
  } catch {
    // use browser default voice
  }

  utterance.onend = () => {
    if (currentlySpeakingKey === key) notify(null);
  };
  utterance.onerror = () => {
    if (currentlySpeakingKey === key) notify(null);
  };

  notify(key);
  try {
    window.speechSynthesis.speak(utterance);
    return true;
  } catch {
    notify(null);
    return false;
  }
}
