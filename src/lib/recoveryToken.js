import { supabase } from "./supabase";
import { markRecoveryActive } from "./recoveryFlag";

/**
 * Redeems a password-recovery `token_hash` (the current reset-email link format)
 * into a live session via `verifyOtp`, exactly once per token.
 *
 * A recovery token_hash is single-use. React 18 StrictMode runs effects twice
 * in dev, a remount replays them, and this client's cross-tab lock is disabled
 * (see lib/supabase.js) — so without this cache the token gets POSTed to
 * `/verify` twice, the second call 403s as "already used", and the racing
 * session writes can leave the client with no session at all: the reset form
 * renders, then `updateUser` throws `AuthSessionMissingError`. Every caller for
 * a given token gets the same in-flight promise.
 *
 * Resolves to `{ session, error }` — `session` is null when the link was spent
 * or expired.
 */
let redemption = { tokenHash: null, promise: null };

export function redeemRecoveryToken(tokenHash, type = "recovery") {
  if (redemption.tokenHash !== tokenHash) {
    markRecoveryActive();
    redemption = {
      tokenHash,
      promise: supabase.auth
        .verifyOtp({ token_hash: tokenHash, type })
        .then(async ({ data, error }) => {
          if (error) return { session: null, error };
          // Confirm the session actually landed in the client, not just that
          // the POST came back 200.
          const session =
            data?.session ?? (await supabase.auth.getSession()).data.session;
          return { session: session ?? null, error: null };
        })
        // verifyOtp normally reports failure as `{ error }`, but lib/supabase.js
        // wraps fetch with a retry that *throws* once it gives up. Without this
        // the chain rejects, the caller's `.then` never runs, and the reset page
        // sits on "Verifying your reset link…" forever — the token_hash path
        // has no timeout of its own. Report it the same way as a refusal.
        .catch((error) => ({ session: null, error })),
    };
  }
  return redemption.promise;
}

/** Test seam: clears the once-per-token cache between cases. */
export function __resetRecoveryRedemption() {
  redemption = { tokenHash: null, promise: null };
}
