// #167: the service worker that makes a desktop notification possible with the
// portal closed. It does nothing else — no offline caching, no asset
// interception — because the manifest and this file exist only to satisfy
// what push requires, not to make the portal an installable application.
//
// Notification routing mirrors src/utils/notificationRouter.js so a clicked
// push lands on the same page a clicked in-app notification would, but this
// file cannot import that module (a service worker is not bundled by Vite),
// so the shape it expects — { type, reference_id } — is kept intentionally
// simple and the actual routing decision is left to the page once it is
// focused or opened.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "Notification", message: event.data.text() };
  }

  const { title, message, type, reference_id, notificationId } = payload;

  event.waitUntil(
    self.registration.showNotification(title || "T3CKGROUP ERP", {
      body: message || "",
      icon: "/tg-logo.svg",
      badge: "/tg-logo.svg",
      tag: notificationId || undefined,
      data: { type, reference_id, notificationId },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const { type, reference_id } = event.notification.data || {};
  const targetUrl = `/?pushType=${encodeURIComponent(type || "")}&pushReferenceId=${encodeURIComponent(
    reference_id || "",
  )}`;

  event.waitUntil(
    (async () => {
      const clientsList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const existing = clientsList[0];
      if (existing) {
        existing.postMessage({ source: "sw-notification-click", type, reference_id });
        return existing.focus();
      }
      return self.clients.openWindow(targetUrl);
    })(),
  );
});
