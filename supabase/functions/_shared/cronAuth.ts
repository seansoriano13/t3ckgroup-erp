// Pure and runtime-agnostic: imported by the edge functions (Deno) and by the
// frontend test runner. No Deno/Node/browser imports here.
//
// Who may call a cron-driven edge function (#457). These functions are deployed
// with verify_jwt = false (supabase/config.toml), so the Edge Functions gateway
// no longer lets the public anon key through on their behalf. The function
// decides itself: Bearer CRON_SECRET (what pg_cron sends, from Vault), or the
// project's service-role key (an operator running a one-off load by hand).
// Anything else, the anon key included, is refused.

export interface CallerSecrets {
  cronSecret?: string | null;
  serviceRoleKey?: string | null;
}

// Compare without bailing at the first differing character.
function sameSecret(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let diff = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}

/** True when `authorization` is `Bearer <a configured secret>`. An unset secret never matches. */
export function isAuthorizedCaller(authorization: string | null | undefined, secrets: CallerSecrets): boolean {
  const match = /^Bearer (.+)$/.exec(authorization ?? "");
  if (!match) return false;
  const token = match[1];
  return [secrets.cronSecret, secrets.serviceRoleKey].some(
    (secret) => typeof secret === "string" && secret.length > 0 && sameSecret(token, secret),
  );
}
