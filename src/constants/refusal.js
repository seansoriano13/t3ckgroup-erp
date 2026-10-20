/**
 * The three SQLSTATEs the database raises for a refusal (#556): the message is
 * the sentence to show, the code says which kind it is. One set so no service
 * spells a bare code.
 */
export const REFUSAL = {
  /** Not yours to do (a role, side or list rule). */
  NOT_ALLOWED: "42501",
  /** An invalid value, or a wrong state for the action. */
  INVALID: "22023",
  /** Already exists. */
  DUPLICATE: "23505",
};
