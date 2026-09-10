/**
 * A password reset creates a short-lived recovery session that lives in
 * localStorage — which every tab of the app sees. Only the /reset-password tab
 * should act on it; any other open tab (a lingering /login, say) would treat
 * the cross-tab `SIGNED_IN` as a real login and, finding no employee match,
 * sign it out from under the reset. This flag, also in localStorage, tells
 * every tab "a reset is mid-flight — leave the session alone".
 *
 * Cleared when the reset finishes or is abandoned; a stale flag self-expires.
 * Kept import-free (no supabase) so lib/supabase.js can set it at module load,
 * before the recovery session is ever written.
 */
const KEY = "t3ck-recovery-active";
const TTL_MS = 10 * 60 * 1000;

export function markRecoveryActive() {
  try {
    localStorage.setItem(KEY, String(Date.now()));
  } catch {
    /* private mode / storage disabled — the route guard still covers this tab */
  }
}

export function clearRecoveryActive() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function isRecoveryActive() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return false;
    const startedAt = Number(raw);
    if (!Number.isFinite(startedAt) || Date.now() - startedAt > TTL_MS) {
      localStorage.removeItem(KEY);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
