/* Hermes Pocket Web Push Service Worker (push-only, never caches app bundles) */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {
    title: "Hermes Bots",
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
  const targetBot = typeof payload.bot === "string" ? payload.bot.trim() : "";
  const targetUrl =
    typeof payload.url === "string" && payload.url.trim()
      ? payload.url.trim()
      : targetBot
        ? `/?bot=${encodeURIComponent(targetBot)}`
        : "/";
  let targetRoom = "";
  let targetSession = "";
  try {
    const parsedUrl = new URL(targetUrl, self.location.origin);
    targetRoom = (parsedUrl.searchParams.get("room") || "").trim();
    targetSession = (parsedUrl.searchParams.get("session") || "").trim();
  } catch {
    // ignore
  }

  event.waitUntil(
    (async () => {
      // Persist target bot/session or group room in Cache Storage before focusing/opening so iOS Safari
      // standalone PWAs never lose the deep-link if postMessage fires while frozen
      // or if openWindow strips query parameters.
      if ((targetBot || targetRoom) && typeof caches !== "undefined") {
        try {
          const cache = await caches.open("hp-push-nav");
          await cache.put(
            "/__pending_push_nav",
            new Response(
              JSON.stringify({
                bot: targetBot,
                session: targetSession,
                room: targetRoom,
                ts: Date.now(),
              }),
              { headers: { "Content-Type": "application/json" } }
            )
          );
        } catch {
          // Non-fatal
        }
      }

      const clients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      for (const client of clients) {
        if ("focus" in client) {
          try {
            await client.focus();
          } catch {
            // ignore focus errors
          }
          const navMsg = targetRoom
            ? { type: "hp:open-room", room: targetRoom }
            : targetBot
              ? { type: "hp:open-bot", bot: targetBot, session: targetSession }
              : null;
          if (navMsg) {
            client.postMessage(navMsg);
            setTimeout(() => {
              try {
                client.postMessage(navMsg);
              } catch {
                // ignore
              }
            }, 350);
          }
          return;
        }
      }

      if (self.clients.openWindow) {
        await self.clients.openWindow(targetUrl);
      }
    })()
  );
});
