/**
 * Turns an edge function call's error into a sentence a person can act on.
 *
 * supabase-js reports a function that answered with a non-2xx status as a
 * FunctionsHttpError, with the response on `error.context`. That is where the
 * function's own JSON `message` lives, when it sent one. Any other error (the
 * function is unreachable, or the relay failed) has no body to read, so the
 * caller's fallback is used. The raw "Edge Function returned a non-2xx status
 * code" text is never returned.
 *
 * @param {unknown} error   the `error` from `supabase.functions.invoke`
 * @param {string}  fallback the user-facing sentence, naming the step that failed
 * @returns {Promise<string>}
 */
export async function functionErrorMessage(error, fallback) {
  if (error?.name !== "FunctionsHttpError") return fallback;
  try {
    const body = await error.context?.json?.();
    const message = typeof body?.message === "string" ? body.message.trim() : "";
    return message || fallback;
  } catch {
    // The body was empty or not JSON. The fallback says enough.
    return fallback;
  }
}
