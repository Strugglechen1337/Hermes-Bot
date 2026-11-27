function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const outputArray = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export interface PushPreferences {
  globalEnabled: boolean;
  disabledBots: string[];
}

export interface PushStatusInfo {
  browserSupported: boolean;
  isStandaloneIos: boolean;
  permission: NotificationPermission | "unsupported";
  subscribed: boolean;
  serverCount: number;
  preferences: PushPreferences;
}

export function isPushSupportedInBrowser(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function isIosStandaloneMode(): boolean {
  if (typeof window === "undefined") return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return (
    Boolean(nav.standalone) ||
    window.matchMedia?.("(display-mode: standalone)").matches
  );
}

export async function getPushRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!isPushSupportedInBrowser()) return null;
  try {
    const existing = await navigator.serviceWorker.getRegistration("/sw.js");
    if (existing) return existing;
    return await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch {
    return null;
  }
}

export async function fetchPushStatus(): Promise<PushStatusInfo> {
  const supported = isPushSupportedInBrowser();
  const isStandalone = isIosStandaloneMode();
  const defaultPrefs: PushPreferences = { globalEnabled: true, disabledBots: [] };
  if (!supported) {
    return {
      browserSupported: false,
      isStandaloneIos: isStandalone,
      permission: "unsupported",
      subscribed: false,
      serverCount: 0,
      preferences: defaultPrefs,
    };
  }

  let subscribed = false;
  let serverCount = 0;
  let preferences: PushPreferences = defaultPrefs;
  try {
    const reg = await navigator.serviceWorker.getRegistration("/sw.js");
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    subscribed = Boolean(sub);

    const res = await fetch("/api/pocket/push/status", { credentials: "same-origin" });
    if (res.ok) {
      const data = (await res.json()) as {
        subscribedCount?: number;
        preferences?: PushPreferences;
      };
      serverCount = Number(data.subscribedCount || 0);
      if (data.preferences && typeof data.preferences === "object") {
        preferences = {
          globalEnabled:
            typeof data.preferences.globalEnabled === "boolean"
              ? data.preferences.globalEnabled
              : true,
          disabledBots: Array.isArray(data.preferences.disabledBots)
            ? data.preferences.disabledBots.filter((x): x is string => typeof x === "string")
            : [],
        };
      }
    }
  } catch {
    // ignore
  }

  return {
    browserSupported: true,
    isStandaloneIos: isStandalone,
    permission: Notification.permission,
    subscribed,
    serverCount,
    preferences,
  };
}

export async function fetchPushPreferences(): Promise<PushPreferences> {
  try {
    const res = await fetch("/api/pocket/push/preferences", { credentials: "same-origin" });
    if (!res.ok) return { globalEnabled: true, disabledBots: [] };
    const data = (await res.json()) as { preferences?: PushPreferences };
    return {
      globalEnabled:
        typeof data.preferences?.globalEnabled === "boolean"
          ? data.preferences.globalEnabled
          : true,
      disabledBots: Array.isArray(data.preferences?.disabledBots)
        ? data.preferences.disabledBots.filter((x): x is string => typeof x === "string")
        : [],
    };
  } catch {
    return { globalEnabled: true, disabledBots: [] };
  }
}

export async function updatePushPreferences(
  patch: Partial<PushPreferences> | { bot: string; enabled: boolean }
): Promise<PushPreferences> {
  const res = await fetch("/api/pocket/push/preferences", {
    method: "PUT",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    throw new Error("Push-Einstellungen konnten nicht gespeichert werden.");
  }
  const data = (await res.json()) as { preferences?: PushPreferences };
  return {
    globalEnabled:
      typeof data.preferences?.globalEnabled === "boolean"
        ? data.preferences.globalEnabled
        : true,
    disabledBots: Array.isArray(data.preferences?.disabledBots)
      ? data.preferences.disabledBots.filter((x): x is string => typeof x === "string")
      : [],
  };
}

export async function enablePushNotifications(): Promise<{ ok: boolean; error?: string }> {
  if (!isPushSupportedInBrowser()) {
    return {
      ok: false,
      error:
        "Push wird in diesem Browser nicht unterstützt. Auf dem iPhone bitte Hermes Pocket über „Zum Home-Bildschirm“ öffnen.",
    };
  }

  const perm = await Notification.requestPermission();
  if (perm !== "granted") {
    return {
      ok: false,
      error: "Mitteilungen wurden nicht erlaubt. Du kannst sie in den iPhone-Einstellungen aktivieren.",
    };
  }

  const reg = await getPushRegistration();
  if (!reg) {
    return { ok: false, error: "Service Worker konnte nicht registriert werden." };
  }

  const statusRes = await fetch("/api/pocket/push/status", { credentials: "same-origin" });
  if (!statusRes.ok) {
    return { ok: false, error: "Push-Konfiguration vom Server nicht erreichbar." };
  }
  const statusData = (await statusRes.json()) as { vapidPublicKey?: string };
  if (!statusData.vapidPublicKey) {
    return { ok: false, error: "Kein VAPID-Schlüssel vom Server erhalten." };
  }

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(statusData.vapidPublicKey),
    });
  }

  const saveRes = await fetch("/api/pocket/push/subscribe", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscription: sub.toJSON() }),
  });
  if (!saveRes.ok) {
    return { ok: false, error: "Push-Abo konnte nicht gespeichert werden." };
  }
  return { ok: true };
}

export async function disablePushNotifications(): Promise<void> {
  if (!isPushSupportedInBrowser()) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration("/sw.js");
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    const endpoint = sub?.endpoint || "";
    if (sub) {
      await sub.unsubscribe();
    }
    await fetch("/api/pocket/push/unsubscribe", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint }),
    });
  } catch {
    // ignore
  }
}

export async function sendTestPushNotification(): Promise<{
  sent: number;
  failed: number;
  lastError?: string;
}> {
  const res = await fetch("/api/pocket/push/test", {
    method: "POST",
    credentials: "same-origin",
  });
  if (!res.ok) {
    throw new Error("Test-Benachrichtigung konnte nicht gesendet werden.");
  }
  const data = (await res.json()) as { sent?: number; failed?: number; lastError?: string };
  return {
    sent: Number(data.sent || 0),
    failed: Number(data.failed || 0),
    lastError: data.lastError,
  };
}

/**
 * Triggers a server-sent Web Push when the app is backgrounded/locked so
 * the user gets a native iPhone banner when a bot replies or needs confirmation.
 */
export function notifyIfBackgrounded(payload: {
  title: string;
  body: string;
  bot?: string;
}): void {
  if (typeof document === "undefined" || document.visibilityState === "visible") return;
  void fetch("/api/pocket/push/notify", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => {
    // Best-effort background notification
  });
}

function sendPresenceUpdate(visible: boolean, useBeacon = false): void {
  const body = JSON.stringify({ visible });
  if (useBeacon && typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    try {
      const blob = new Blob([body], { type: "application/json" });
      if (navigator.sendBeacon("/api/pocket/push/presence", blob)) {
        return;
      }
    } catch {
      // fall back to keepalive fetch
    }
  }
  void fetch("/api/pocket/push/presence", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {
    // ignore transient network errors
  });
}

/**
 * Reports whether the PWA is currently visible in the foreground so the
 * server-side push watcher sends native Web Push banners whenever the iPhone
 * is locked or backgrounded without spamming while the user is actively viewing.
 */
export function startPushPresenceHeartbeat(): () => void {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return () => {};
  }

  const reportNow = (useBeacon = false) => {
    const visible = document.visibilityState === "visible";
    sendPresenceUpdate(visible, useBeacon || !visible);
  };

  reportNow(false);

  const onVisibility = () => reportNow(document.visibilityState !== "visible");
  const onPageHide = () => sendPresenceUpdate(false, true);

  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", onPageHide);

  const timer = window.setInterval(() => {
    if (document.visibilityState === "visible") {
      sendPresenceUpdate(true, false);
    }
  }, 25_000);

  return () => {
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pagehide", onPageHide);
    window.clearInterval(timer);
    sendPresenceUpdate(false, true);
  };
}
