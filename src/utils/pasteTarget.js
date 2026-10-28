/**
 * True when a paste started inside a text box (chat composer, notes, etc.).
 * Page-wide image paste listeners must leave those pastes to the focused box.
 */
export function isPasteInsideTextField(event) {
  const el = event?.target
  if (!el || typeof el.closest !== "function") return false
  return Boolean(el.closest("textarea, input, [contenteditable='true'], [contenteditable='']"))
}
