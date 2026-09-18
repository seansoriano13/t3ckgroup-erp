/**
 * The reissue/issue rules for password login (issue #162/#164), as pure
 * predicates — the same rules the manage-employee-password edge function
 * enforces server-side (that function can't import from src/, being a
 * separately-deployed Deno runtime, so it re-states them inline; this module
 * is what proves the rules themselves at Seam D, and any change here should
 * be mirrored there).
 */

/** Only HR or a Super Admin may issue a brand-new employee's first password. */
export function canIssuePassword({ isSuperAdmin, isHr }) {
  return !!isSuperAdmin || !!isHr;
}

/**
 * A Super Admin may reissue a password only while the employee is still on
 * the one they were issued. Once they've set their own, this is refused
 * unconditionally — even for a Super Admin — because the rule is "email
 * verification only" past that point, not "Super Admin can still override".
 */
export function canReissuePassword({ isSuperAdmin, isIssuedPassword }) {
  return !!isSuperAdmin && !!isIssuedPassword;
}

/** A random, per-employee password. Never derived from anything guessable. */
export function generateIssuedPassword() {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  const b64 = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "9")
    .replace(/\//g, "8")
    .replace(/=/g, "");
  return `${b64}!Aa1`;
}
