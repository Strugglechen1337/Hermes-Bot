/* Hermes Pocket Web Push Service Worker (push-only, never caches app bundles) */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {
    title: "Hermes Pocket",
    body: "Neue Nachricht von deinem Bot.",
    bot: "",
    tag: "hermes-pocket",
    url: "/",
  };
  if (event.data) {
    try {
      const parsed = event.data.json();
      if (parsed && typeof parsed === "object") {
        data = { ...data, ...parsed };
      }
    } catch {
      try {
        data.body = event.data.text();
      } catch {
        // ignore
      }
    }
  }

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(data.title, {
        body: data.body,
        icon: "/icon-180.png",
        badge: "/icon-180.png",
        tag: data.tag || "hermes-pocket",
        renotify: true,
        data: {
          bot: data.bot || "",
          url: data.url || "/",
        },
      }),
      data.bot
        ? self.clients
            .matchAll({ type: "window", includeUncontrolled: true })
            .then((clients) => {
              for (const client of clients) {
                client.postMessage({
                  type: "hp:bot-message",
                  bot: data.bot,
                  title: data.title,
                  body: data.body,
                });
              }
            })
        : Promise.resolve(),
    ])
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const payload = event.notification.data || {};
  const targetBot = typeof payload.bot === "string" ? payload.bot : "";
  const targetUrl = typeof payload.url === "string" ? payload.url : "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.focus();
          if (targetBot) {
            client.postMessage({ type: "hp:open-bot", bot: targetBot });
          }
          return;
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
      return undefined;
    })
  );
});
