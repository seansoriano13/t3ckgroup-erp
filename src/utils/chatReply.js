/**
 * Builds the lightweight snapshot stored on a message's metadata.replyTo.
 * A snapshot (not just an id) so the quoted preview survives even if the
 * original entry is later edited, deleted, or hard to look up.
 */
export function buildReplySnapshot(entry) {
  if (!entry) return null;
  const hasAttachments = entry.metadata?.attachments?.length > 0;
  return {
    id: entry.id,
    authorId: entry.authorId,
    authorName: entry.authorName || "Someone",
    content: entry.content?.trim() ? entry.content : hasAttachments ? "📷 Photo" : "",
  };
}
