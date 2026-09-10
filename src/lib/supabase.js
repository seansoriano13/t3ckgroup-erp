// lib/supabase.js

import { createClient } from "@supabase/supabase-js";
import { markRecoveryActive } from "./recoveryFlag";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;


// Simple delay helper
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

const DEFAULT_TIMEOUT_MS = 20000;

/**
 * Custom fetch wrapper with retry logic and timeout handling.
 * Addresses "supabase not responding" by retrying transient network errors.
 *
 * A caller that brings its own AbortSignal is taken to be managing its own
 * deadline, and is left to it: no default timeout on top, and no retry once it
 * aborts. That exists for the quotation download. Odoo can legitimately spend
 * minutes rendering a quotation that still has brochures merged into it, so the
 * 20s default would abort it every time — and the retry below would then start
 * a *second* render while the first was still running, which is how one slow
 * request became three. See quotationService.
 */
const customFetch = async (url, options, retries = 2) => {
  const callerSignal = options?.signal;
  const callerOwnsDeadline = !!callerSignal;

  const controller = new AbortController();
  const id = callerOwnsDeadline
    ? null
    : setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  const startTime = Date.now();

  // Compose rather than replace: supabase-js passes the caller's signal
  // straight through to us, and overwriting it would strip the only means a
  // caller has of cancelling.
  const onCallerAbort = () => controller.abort();
  if (callerSignal?.aborted) controller.abort();
  else callerSignal?.addEventListener("abort", onCallerAbort);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });

    if (!response.ok) {
      const retryableStatuses = [502, 503, 504, 525];

      if (retryableStatuses.includes(response.status) && retries > 0) {
        console.warn(
          `[Supabase] Retry (${retries}) → ${response.status} → ${url}`
        );
        await sleep(500);
        return customFetch(url, options, retries - 1);
      }

      if (response.status === 525) {
        console.error(
          "[Supabase] SSL Handshake Failed (525) → network/HTTP3 issue"
        );
      }
    }

    return response;
  } catch (err) {
    const duration = Date.now() - startTime;
    const aborted = err.name === "AbortError";

    // A caller-owned deadline has already been given all the time it asked
    // for. Retrying would start a second run of the same slow server-side work
    // while the first is very likely still going.
    const isRetryableError =
      (aborted && !callerOwnsDeadline) ||
      err instanceof TypeError ||
      err.message?.includes("Failed to fetch");

    if (isRetryableError && retries > 0) {
      console.warn(
        `[Supabase] Retry (${retries}) due to network error → ${url}`
      );
      await sleep(500);
      return customFetch(url, options, retries - 1);
    }

    if (aborted) {
      console.error(`[Supabase] Timeout (${duration}ms) → ${url}`);
      throw new Error(
        callerOwnsDeadline
          ? `The server took longer than ${Math.round(duration / 1000)}s to answer and the request was given up on. Please try again.`
          : "Request timeout. The connection may be unstable. Please try again."
      );
    }

    console.error(`[Supabase] Fetch Error (${duration}ms) → ${url}`, err);
    throw err;
  } finally {
    if (id) clearTimeout(id);
    callerSignal?.removeEventListener("abort", onCallerAbort);
  }
};

/**
 * The auth params in the URL at first paint, captured before the client is
 * built. `detectSessionInUrl` consumes the recovery hash and then wipes it
 * with `history.replaceState`, so by the time the /reset-password screen's
 * effect runs the live URL is already clean either way. This snapshot lets
 * that screen still tell apart the three landings: GoTrue rejected the token
 * (`#error=access_denied&error_code=otp_expired…`), a good token that's still
 * being exchanged, and someone who reached the route with no token at all.
 */
export const initialAuthUrlParams =
  typeof window === "undefined"
    ? { hash: "", search: "" }
    : { hash: window.location.hash || "", search: window.location.search || "" };

// Landing on the reset route with recovery params: flag it for every tab now,
// before detectSessionInUrl writes the recovery session to localStorage, so a
// lingering /login tab can't race in and sign it out. See lib/recoveryFlag.js.
if (
  typeof window !== "undefined" &&
  window.location.pathname === "/reset-password" &&
  /token_hash|access_token|[?&#]code=|type=recovery/.test(
    `${initialAuthUrlParams.hash}${initialAuthUrlParams.search}`,
  )
) {
  markRecoveryActive();
}

/**
 * Singleton protection for the Supabase client.
 * Prevents "multiple Supabase clients" issues during HMR or multi-tab usage.
 */
if (!globalThis._supabaseInstance) {
  globalThis._supabaseInstance = createClient(supabaseUrl, supabaseKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
      storageKey: 't3ckgroup-auth-session', // Specific key to avoid conflicts
      lock: (name, acquireTimeout, fn) => fn(), // Prevents LockAcquireTimeoutError during Vite HMR reloads
    },
    global: {
      fetch: customFetch,
    },
    realtime: {
      params: {
        eventsPerSecond: 10,
      },
      // Aggressive heartbeat to detect dropped connections (default is 15s)
      heartbeatIntervalMs: 8000, 
    },
  });
}

export const supabase = globalThis._supabaseInstance;

/**
 * Whether this build is pointed at the production Supabase project.
 *
 * There is no `VITE_APP_ENV` — staging and production are separated by which
 * Supabase project the deploy's `VITE_SUPABASE_URL` points at (ADR 0005), not
 * by an app-level flag. epqmberwewztzbrkhhss is that production project ref;
 * everything else (the staging project, the fake `supabase.test` origin the
 * test harness uses) is not production.
 *
 * The one caller today is the Flow Canvas (issue #36): "The canvas and its
 * Scratch SORs live on staging. Production is never the drafting surface."
 * Fragile in the sense that a production project migration would need this
 * updated too — accepted, because inventing a second, independently
 * maintained "which environment am I" signal risks the two disagreeing.
 */
export const isProductionSupabase = Boolean(supabaseUrl?.includes("epqmberwewztzbrkhhss"));