/** Shown when a log cannot load. The database's own text never reaches the page. */
export const LOG_LOAD_ERROR_MESSAGE = "Could not load the log. Try again."

/** Turns a database error into a plain one. It keeps the status so a 400 is not retried. */
export function plainLogError(error) {
  const plain = new Error(LOG_LOAD_ERROR_MESSAGE)
  plain.status = error?.status ?? null
  plain.cause = error
  return plain
}

/**
 * Builds the `%text%` pattern for an ILIKE search. `\`, `%`, `_` and `*` are
 * escaped so each one is searched for as itself (PostgREST reads `*` as `%`).
 */
export function likePattern(text) {
  const esc = text.replace(/[\\%_*]/g, "\\$&")
  return `%${esc}%`
}

/**
 * Wraps a value in double quotes for a PostgREST `.or(...)` filter, so a comma,
 * bracket or quote inside it cannot end the value early.
 */
export function quoteFilterValue(value) {
  return `"${value.replace(/[\\"]/g, "\\$&")}"`
}
