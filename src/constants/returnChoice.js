/**
 * Issue #390 — what a Return (entering a Stage the SOR has an earlier,
 * not-undone visit on) does with that Stage's earlier work. Start fresh is
 * offered but not built yet; only the choices in AVAILABLE are accepted.
 */
export const RETURN_CHOICE = Object.freeze({
  RESUME: "resume",
  START_FRESH: "start_fresh",
})

export const AVAILABLE_RETURN_CHOICES = Object.freeze([RETURN_CHOICE.RESUME])
