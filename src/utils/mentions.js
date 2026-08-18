/**
 * Mention parsing, kept out of the component so it can be tested directly and
 * so the component file only exports components (react-refresh).
 */

/** The `@token` being typed immediately before the caret, if there is one. */
export function activeMentionQuery(text, caret) {
  const upToCaret = (text || "").slice(0, caret);
  const at = upToCaret.lastIndexOf("@");
  if (at === -1) return null;

  // Must start a word: "name@company.com" is an email, not a mention.
  const before = at > 0 ? upToCaret[at - 1] : " ";
  if (!/\s/.test(before)) return null;

  const token = upToCaret.slice(at + 1);
  // A mention ends at a newline; a single space is allowed so "@Cjay Es" keeps
  // matching a full name.
  if (/[\n]/.test(token) || token.split(" ").length > 2) return null;

  return { at, token };
}
