// lib/supabase.js

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * Names the missing Supabase environment variables, or null if both are set.
 * Exported for the test that pins the message; callers want assertSupabaseConfig.
 */
export function missingSupabaseConfig(env = { url: supabaseUrl, key: supabaseKey }) {
  const missing = [];
  if (!env.url) missing.push("VITE_SUPABASE_URL");
  if (!env.key) missing.push("VITE_SUPABASE_ANON_KEY");
  return missing.length > 0 ? missing : null;
}

/**
 * Fails with a message that says what to do about it.
 *
 * This module is reached at import time — main.jsx statically imports
 * AuthContext, which statically imports this file — so createClient() below
 * runs before createRoot().render() ever does. Without this check the app
 * dies on supabase-js's own "supabaseUrl is required.", thrown before the
 * React tree (and therefore the ErrorBoundary in main.jsx) exists, and the
 * only symptom is a blank white page: no login form, no error screen. That
 * reads like a broken login rather than an unconfigured checkout, which is
 * exactly the wrong place to start looking.
 */
function assertSupabaseConfig() {
  const missing = missingSupabaseConfig();
  if (!missing) return;

  throw new Error(
    `Supabase is not configured: ${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} missing. ` +
      "Copy .env.example to .env in the project root and fill in the project URL and anon key. " +
      "The app cannot start without them — this is a missing local .env, not a login failure.",
  );
}

assertSupabaseConfig();

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

  // Log connectivity state for debugging
  globalThis._supabaseInstance.auth.onAuthStateChange((event, session) => {
    console.log(`[Supabase Auth] ${event}`, session?.user?.email || 'No session');
  });
}

export const supabase = globalThis._supabaseInstance;
