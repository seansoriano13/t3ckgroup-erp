/**
 * #476: the composer's line saying what a Mention will open, so the writer sees
 * the consequence before posting.
 */

/** Mentions still named in the note (a deleted name is a change of mind), minus the writer. */
export function liveMentionIds(mentions, text, writerId) {
  return (mentions || []).filter((m) => m?.id && m.id !== writerId && text.includes(`@${m.name}`)).map((m) => m.id)
}

/** `windowIds` are the people `sor_mention_window_candidates` said would gain a window. */
export function mentionWindowHint(mentions, windowIds, { hasVisits }) {
  const names = (mentions || []).filter((m) => windowIds.includes(m.id)).map((m) => m.name)
  if (names.length === 0) return null
  const who = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
  const verb = names.length === 1 ? "gets" : "get"
  return hasVisits ? `${who} ${verb} access to this Stage until it moves.` : `${who} ${verb} read-only access to this SOR.`
}
