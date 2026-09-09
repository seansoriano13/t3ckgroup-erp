import { pushSubscriptionService } from "../services/pushSubscriptionService";

/** #167: desktop browsers only — no promise made about iOS without a home-screen install. */
export function isPushSupported() {
  return "serviceWorker" in navigator && "PushManager" in window;
}

/** Converts the VAPID public key from base64url, the shape pushManager.subscribe expects. */
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

/**
 * Requests permission and stores a subscription for this browser. Called
 * only from a deliberate action — never on load — per #166's decision that
 * permission is the employee's to give.
 *
 * Returns false, without throwing, if the person declines: declining must
 * cost nothing.
 */
export async function enablePushNotifications(employeeId) {
  if (!isPushSupported()) return false;

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return false;

  const registration = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;

  const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: vapidPublicKey ? urlBase64ToUint8Array(vapidPublicKey) : undefined,
  });

  await pushSubscriptionService.subscribe(employeeId, subscription);
  return true;
}

/** Turns push off for this browser. A decision made once is not permanent. */
export async function disablePushNotifications(employeeId) {
  if (!isPushSupported()) return;

  const registration = await navigator.serviceWorker.getRegistration("/sw.js");
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription) {
    await pushSubscriptionService.unsubscribe(employeeId, subscription.endpoint);
    await subscription.unsubscribe();
  }
}

/** Whether this browser currently holds a push subscription. */
export async function isPushEnabled() {
  if (!isPushSupported()) return false;
  const registration = await navigator.serviceWorker.getRegistration("/sw.js");
  const subscription = await registration?.pushManager.getSubscription();
  return !!subscription;
}
