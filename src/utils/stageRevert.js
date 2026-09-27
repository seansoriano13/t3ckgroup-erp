/**
 * Whether "Revert to last stage" is on offer — a client-side read of the
 * rules `sor_revert_stage` enforces (the function stays the real gate).
 *
 * `visits` are the SOR's Stage Visits ({ sequence, left_at, undone_at,
 * entered_by, opened_by_revert }). Possible only when the SOR has moved (an
 * earlier, not undone visit exists) and the last move was not itself a Revert
 * (one step only): the latest visit is neither an undone one nor the visit a
 * Keep/Remove Revert opened. Allowed for whoever made the latest move, the Deal Owner, or a Super
 * Admin.
 */
export function canRevertStage({ visits = [], opportunity, user }) {
  if (!user?.id || !opportunity) return false;

  const bySequence = [...visits].sort((a, b) => b.sequence - a.sequence);
  const latest = bySequence[0];
  if (!latest || latest.undone_at) return false;

  const current = bySequence.find((v) => !v.left_at && !v.undone_at);
  if (!current || current.opened_by_revert) return false;
  const hasEarlier = bySequence.some((v) => !v.undone_at && v.sequence < current.sequence);
  if (!hasEarlier) return false;

  const isSuperAdmin = !!(user.is_super_admin || user.isSuperAdmin);
  return (
    isSuperAdmin ||
    current.entered_by === user.id ||
    opportunity.deal_owner_id === user.id
  );
}
