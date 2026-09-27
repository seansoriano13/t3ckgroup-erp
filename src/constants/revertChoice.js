/**
 * Issue #392 — what a Revert does with Stage Work done on the Stage being
 * left, when there is any to decide about.
 */
export const REVERT_CHOICE = Object.freeze({
  KEEP: "keep",
  REMOVE: "remove",
})
