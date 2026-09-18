import { useEffect } from "react";
import { handleNotificationRoute } from "../utils/notificationRouter";

/**
 * #167/#168: routes a clicked desktop push the same way a clicked in-app
 * notification routes. sw.js cannot import notificationRouter.js — a service
 * worker is not bundled by Vite — so it hands off `{ type, reference_id }` in
 * one of two shapes, depending on whether a tab was already open when the
 * click landed:
 *
 *   - a tab existed: sw.js focuses it and posts a `sw-notification-click`
 *     message, handled directly below.
 *   - no tab existed: sw.js opens one at `/?pushType=...&pushReferenceId=...`
 *     (`self.clients.openWindow` cannot post a message to a window that
 *     doesn't exist yet), and this hook reads those query params once the
 *     app has mounted, then strips them so a refresh doesn't re-route.
 */
export function usePushNotificationClick(user, navigate) {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !user) return undefined;

    const onMessage = (event) => {
      if (event.data?.source !== "sw-notification-click") return;
      handleNotificationRoute(
        { type: event.data.type, reference_id: event.data.reference_id },
        user,
        navigate,
        () => {},
      );
    };

    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [user, navigate]);

  useEffect(() => {
    if (!user) return;

    const params = new URLSearchParams(window.location.search);
    const type = params.get("pushType");
    const reference_id = params.get("pushReferenceId");
    if (!type) return;

    params.delete("pushType");
    params.delete("pushReferenceId");
    const rest = params.toString();
    window.history.replaceState(null, "", window.location.pathname + (rest ? `?${rest}` : ""));

    handleNotificationRoute({ type, reference_id }, user, navigate, () => {});
  }, [user, navigate]);
}
