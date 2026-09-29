import { getPermissionContext } from "./permissions";

/**
 * Issue #294: removing a Stage Participant is narrower than editing the SOR
 * generally — only the Deal Owner or a Super Admin, mirroring
 * `sor_stage_participants_update` (20260925000000_stage_participants.sql).
 */
export function canRemoveParticipant(user, sor) {
  if (!user || !sor) return false;

  const { isSuperAdmin } = getPermissionContext(user);
  if (isSuperAdmin) return true;

  return sor.deal_owner_id === user.id;
}
