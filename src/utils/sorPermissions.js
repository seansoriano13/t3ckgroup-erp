import { getPermissionContext } from "./permissions";

/**
 * Validates whether a user has edit permissions for a given Sales Opportunity (SOR),
 * perfectly mirroring the RLS policy for `sor_update` in the database.
 *
 * @param {Object} user The authenticated user/employee object
 * @param {Object} sor The sales opportunity record
 * @returns {boolean} True if the user has permission to edit the SOR
 */
export function canEditSor(user, sor) {
  if (!user || !sor) return false;

  // Heads and Super Admins have org-wide edit access
  const { isHead, isSuperAdmin } = getPermissionContext(user);
  if (isHead || isSuperAdmin) {
    return true;
  }

  // The participants on the deal
  const authorizedIds = [
    sor.registered_by,
    sor.deal_owner_id,
    sor.support_sales_1_id,
    sor.support_sales_2_id,
    sor.sales_director_id,
  ];

  return authorizedIds.includes(user.id);
}
