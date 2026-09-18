/**
 * The one place that knows what a password-recovery landing looks like.
 *
 * Two callers need this and used to answer it differently: lib/supabase.js
 * decides at module load whether to raise the cross-tab recovery flag, and
 * pages/reset-password decides which of the three landings it is looking at.
 * A regex in one and a set of `get()` calls in the other are the same rule
 * written twice, and the pair drifting apart is how the flag gets raised on a
 * page with no reset in flight.
 *
 * Kept free of any supabase import: lib/supabase.js imports it while it is
 * still building its own client.
 */

/** Where the reset email lands, and the only route that owns a recovery session. */
export const RESET_PASSWORD_PATH = "/reset-password";

/**
 * Is this the reset route? React Router matches `/reset-password/` too, and a
 * bare `===` would answer no at every one of the five call sites at once — no
 * boot snapshot, no AuthContext guard, no full-bleed layout — so the trailing
 * slash is normalised here rather than at each of them.
 */
export function isResetPasswordPath(pathname = "") {
  return (pathname || "").replace(/\/+$/, "") === RESET_PASSWORD_PATH;
}

/**
 * Reads the recovery-relevant parts of a `{ hash, search }` pair.
 *
 * GoTrue reports a rejected link in the fragment (implicit flow); the newer
 * `&sb=` variant and the PKCE flow use the query string — so both are checked,
 * fragment first.
 */
export function readRecoveryParams({ hash = "", search = "" } = {}) {
  const fragment = new URLSearchParams((hash || "").replace(/^#/, ""));
  const query = new URLSearchParams(search || "");
  const get = (key) => fragment.get(key) || query.get(key);

  return {
    // GoTrue turned the link down before the app ever saw it.
    hasError: Boolean(get("error") || get("error_code")),
    errorDescription: (get("error_description") || "").replace(/\+/g, " "),
    // The current email links straight here with a token_hash for the app to
    // redeem via verifyOtp(); older `/auth/v1/verify` links arrive already
    // exchanged, as an implicit `#access_token` fragment or a PKCE `?code`.
    tokenHash: get("token_hash") || "",
    otpType: get("type") || "recovery",
    // A recovery token was in the URL — so "no session" means it was turned
    // down, not that the visitor wandered in without a link.
    hasRecoveryToken:
      Boolean(get("access_token") || get("token_hash") || get("code")) ||
      get("type") === "recovery",
  };
}

/**
 * Is this URL a real recovery landing — the reset route, carrying a token?
 * Both halves matter: the route alone is someone who navigated there by hand,
 * and the params alone can be a Google OAuth fragment on /login.
 */
export function isRecoveryLanding({ pathname = "", hash = "", search = "" } = {}) {
  if (!isResetPasswordPath(pathname)) return false;
  const params = readRecoveryParams({ hash, search });
  return params.hasRecoveryToken || params.hasError;
}
