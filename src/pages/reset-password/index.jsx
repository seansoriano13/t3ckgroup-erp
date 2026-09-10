import { useEffect, useState } from "react";
import { Link } from "react-router";
import toast from "react-hot-toast";
import { supabase, initialAuthUrlParams } from "../../lib/supabase";
import { redeemRecoveryToken } from "../../lib/recoveryToken";
import { markRecoveryActive, clearRecoveryActive } from "../../lib/recoveryFlag";
import { passwordService } from "../../services/passwordService";
import PrimaryButton from "../../components/PrimaryButton";
import Spinner from "@/components/ui/Spinner";
import { AUTH_INPUT_STYLE as INPUT_STYLE } from "../../constants/authForm.js";

/**
 * Where the password-reset email link lands.
 *
 * The current email (supabase/templates/recovery.html) links straight here with
 * `?token_hash=…&type=recovery` and we redeem it with `verifyOtp` — a POST, so
 * mail-scanner and browser prefetches of the link can't spend the one-time
 * token. Older `/auth/v1/verify` links still work: they arrive already
 * exchanged as an implicit `#access_token` fragment or a PKCE `?code`, which
 * `detectSessionInUrl` handles, and a rejected one comes back as
 * `#error=access_denied&error_code=otp_expired…`.
 *
 * Either way the form must not show until a recovery session is confirmed —
 * otherwise `updateUser` fails with a bare "Auth session missing" on Save.
 * Phases: verifying → ready (form) | invalid (notice + link back to login).
 *
 * AuthContext deliberately ignores auth events while this route is open (the
 * recovery session is not a normal login; resolving it there would tear it
 * down), so a finished reset leaves via a full page load, not a client nav, to
 * force a clean boot against the completed session.
 */
// Only a safety net: getSession() already awaits the client's URL exchange, so
// a definite yes/no normally arrives well before this.
const VERIFY_TIMEOUT_MS = 12000;

const EXPIRED_COPY =
  "Your reset link has expired, or it has already been opened once.";
const NO_TOKEN_COPY =
  "Open this page from the link in your password-reset email.";

/**
 * What the URL said when the app booted. GoTrue reports a rejected link in the
 * fragment (implicit flow); the newer `&sb=` variant and the PKCE flow use the
 * query string — so check both. Falls back to the live URL for tests, which
 * drive the route directly and never populate the boot-time snapshot.
 */
function readAuthParams() {
  const snap =
    initialAuthUrlParams.hash || initialAuthUrlParams.search
      ? initialAuthUrlParams
      : { hash: window.location.hash, search: window.location.search };
  const hash = new URLSearchParams((snap.hash || "").replace(/^#/, ""));
  const query = new URLSearchParams(snap.search || "");
  const get = (key) => hash.get(key) || query.get(key);

  return {
    hasError: Boolean(get("error") || get("error_code")),
    errorDescription: (get("error_description") || "").replace(/\+/g, " "),
    // The current email links here directly with a token_hash for us to redeem
    // via verifyOtp(); older `/auth/v1/verify` links arrive already exchanged,
    // as an implicit `#access_token` fragment or a PKCE `?code`.
    tokenHash: get("token_hash") || "",
    otpType: get("type") || "recovery",
    // A recovery token was in the URL — so "no session" means it was turned
    // down, not that the visitor wandered in without a link.
    hasRecoveryToken:
      Boolean(get("access_token") || get("token_hash") || get("code")) ||
      get("type") === "recovery",
  };
}

/** Drops the token_hash from the address bar once it has been redeemed. */
function scrubTokenFromUrl() {
  if (typeof window === "undefined" || !window.location.search) return;
  try {
    window.history.replaceState(window.history.state, "", window.location.pathname);
  } catch {
    /* replaceState can throw in some embedded contexts; harmless to skip */
  }
}

export default function ResetPassword() {
  const [phase, setPhase] = useState("verifying"); // "verifying" | "ready" | "invalid"
  const [invalidReason, setInvalidReason] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let settled = false;
    let subscription;
    let timer;
    const params = readAuthParams();

    // Tell every open tab a reset is mid-flight so none of them acts on the
    // recovery session that's about to appear in shared storage. Covers the
    // implicit `#access_token` link too, where redeemRecoveryToken never runs.
    if (params.hasRecoveryToken) markRecoveryActive();

    const done = (nextPhase, reason) => {
      if (settled) return;
      settled = true;
      // A dead link releases the other tabs; a live one keeps the hold until
      // the password is actually saved.
      if (nextPhase === "invalid") clearRecoveryActive();
      if (reason) setInvalidReason(reason);
      setPhase(nextPhase);
    };
    const noSessionCopy = () =>
      params.hasRecoveryToken ? EXPIRED_COPY : NO_TOKEN_COPY;

    if (params.hasError) {
      // GoTrue turned the link down before it ever reached us.
      done("invalid", params.errorDescription || EXPIRED_COPY);
    } else if (params.tokenHash) {
      // Current-style link: redeem the token_hash ourselves. This POST is the
      // moment the one-time token is spent — a prefetch of the link never gets
      // here — and a success is a live recovery session.
      timer = setTimeout(() => done("invalid", noSessionCopy()), VERIFY_TIMEOUT_MS);
      redeemRecoveryToken(params.tokenHash, params.otpType).then(
        ({ session, error }) => {
          scrubTokenFromUrl();
          if (session) done("ready");
          else done("invalid", error?.message?.replace(/\+/g, " ") || EXPIRED_COPY);
        },
      );
    } else {
      // Older `/auth/v1/verify` link: it arrives already exchanged. A late
      // recovery session (detectSessionInUrl finishing) flips us to the form;
      // getSession() waits for that exchange, so its answer is authoritative.
      subscription = supabase.auth.onAuthStateChange((_event, session) => {
        if (session) done("ready");
        else if (_event === "SIGNED_OUT") done("invalid", noSessionCopy());
      }).data.subscription;

      supabase.auth.getSession().then(({ data }) => {
        done(
          data?.session ? "ready" : "invalid",
          data?.session ? undefined : noSessionCopy(),
        );
      });

      timer = setTimeout(() => done("invalid", noSessionCopy()), VERIFY_TIMEOUT_MS);
    }

    // Closing the tab is the likeliest way a reset gets abandoned, and React
    // does not run cleanup for that — `pagehide` does. Same release as below.
    const releaseOnLeave = () => clearRecoveryActive();
    window.addEventListener("pagehide", releaseOnLeave);

    return () => {
      settled = true;
      subscription?.unsubscribe();
      clearTimeout(timer);
      window.removeEventListener("pagehide", releaseOnLeave);
      // Leaving the route with the reset unfinished must release the hold.
      // A stale flag makes AuthContext's skipForRecovery() true in every tab
      // for the flag's whole TTL, and that guard is the only path that
      // resolves the employee on boot — so the app renders signed-out until
      // it expires. The success path clears it and full-loads before this
      // runs; StrictMode's remount re-marks it.
      clearRecoveryActive();
    };
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!password) {
      toast.error("Enter a password.");
      return;
    }
    if (password !== confirmPassword) {
      toast.error("Passwords do not match.");
      return;
    }

    setIsSubmitting(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;

      // Cleared unconditionally: harmless if it was already false, and this
      // is the only place a self-chosen password ever gets set.
      try {
        await passwordService.clearIssuedPasswordFlag();
      } catch (flagError) {
        console.error("Failed to clear issued-password flag:", flagError);
      }

      toast.success("Password updated. You're all set.");
      // The session is now an ordinary one — let the other tabs resume, and
      // full-load rather than client-nav so AuthContext boots fresh and
      // resolves the employee behind it.
      clearRecoveryActive();
      window.location.assign("/");
    } catch (error) {
      console.error("Password update failed:", error);
      const sessionGone = /session|expired|invalid/i.test(error.message || "");
      if (sessionGone) {
        clearRecoveryActive();
        setInvalidReason("Your reset link has expired.");
        setPhase("invalid");
      } else {
        toast.error(error.message || "Could not update your password.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (phase === "verifying") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-mauve-2 px-4">
        <div className="flex flex-col items-center gap-3 text-mauve-10">
          <Spinner size="md" />
          <p className="text-sm font-bold uppercase tracking-widest animate-pulse">
            Verifying your reset link…
          </p>
        </div>
      </div>
    );
  }

  if (phase === "invalid") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-mauve-2 px-4">
        <div className="bg-white max-w-md w-full rounded-2xl border border-mauve-6 shadow-sm p-8 space-y-4 text-center">
          <h1 className="text-2xl font-bold text-mauve-12">
            Can&rsquo;t reset your password
          </h1>
          <p className="text-mauve-10 text-sm">{invalidReason}</p>
          <p className="text-mauve-10 text-sm">
            Reset links open only once and time out after a while &mdash; request
            a fresh one from the login page and use it straight away.
          </p>
          <Link
            to="/login"
            className="inline-block bg-mauve-3 hover:bg-mauve-4 border border-mauve-6 text-mauve-12 px-6 py-3 rounded-xl font-bold transition-all"
          >
            Back to login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-mauve-2 px-4">
      <form
        onSubmit={handleSubmit}
        className="bg-white max-w-md w-full rounded-2xl border border-mauve-6 shadow-sm p-8 space-y-5"
      >
        <div>
          <h1 className="text-2xl font-bold text-mauve-12">Set a new password</h1>
          <p className="text-mauve-10 text-sm mt-1">
            Choose a password for your T3ckgroup account.
          </p>
        </div>

        <div className="grid gap-2">
          <label htmlFor="new-password" className="text-xs font-bold text-mauve-11 uppercase tracking-wider">
            New Password
          </label>
          <input
            id="new-password"
            className={`${INPUT_STYLE} cursor-text`}
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        <div className="grid gap-2">
          <label htmlFor="confirm-password" className="text-xs font-bold text-mauve-11 uppercase tracking-wider">
            Confirm Password
          </label>
          <input
            id="confirm-password"
            className={`${INPUT_STYLE} cursor-text`}
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </div>

        <PrimaryButton
          label={isSubmitting ? "Saving..." : "Save Password"}
          className={`w-full ${isSubmitting ? "opacity-70 cursor-not-allowed" : ""}`}
        />
      </form>
    </div>
  );
}
