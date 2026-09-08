/**
 * The one place that answers what the current person may do.
 *
 * The service layer camelCases every capability flag (`isSuperAdmin`), a
 * cached or hand-built profile may still carry the raw DB spelling
 * (`is_super_admin`). Every call site used to test both; this reconciles
 * them once so nothing downstream has to know two spellings exist.
 */
export function getPermissionContext(user) {
  const isSuperAdmin = !!(user?.is_super_admin || user?.isSuperAdmin);
  const isHead = !!(user?.is_head || user?.isHead);
  const isHr = !!(user?.is_hr || user?.isHr);
  const canManageLeaves = !!(user?.can_manage_leaves || user?.canManageLeaves);
  const hasSalesFlow = !!(user?.has_sales_flow ?? user?.hasSalesFlow);
  const hasTaskFlow = !!(user?.has_task_flow ?? user?.hasTaskFlow);
  const hasPurchasingFlow = !!(user?.has_purchasing_flow ?? user?.hasPurchasingFlow);
  const isRoleSimulator = !!(user?.is_role_simulator || user?.isRoleSimulator);
  const subDepartment = user?.subDepartment || user?.sub_department || null;
  const canManage = isHead || isSuperAdmin;
  const hiddenNavKeys = user?.hidden_nav_keys || user?.hiddenNavKeys || [];

  return {
    user,
    isSuperAdmin,
    isHead,
    isHr,
    canManageLeaves,
    hasSalesFlow,
    hasTaskFlow,
    hasPurchasingFlow,
    isRoleSimulator,
    subDepartment,
    canManage,
    hiddenNavKeys,
  };
}

/**
 * Whether one navigation entry (a nav link or a quick action) should be
 * shown to the person `ctx` describes.
 *
 * Subtractive only: `entry.isPermitted(ctx) AND NOT hidden`. The override
 * can never reveal an entry the capability flags deny — an entry a person's
 * flags don't permit stays invisible no matter what the override says,
 * because the override is a hide-list, not an allow-list, and there is no
 * code path that lets it add anything back. An entry with no `key` (or a
 * `hiddenNavKeys` entry that names no current key) is never hidden by this.
 */
export function isNavEntryVisible(ctx, entry) {
  if (!entry.isPermitted(ctx)) return false;
  if (!entry.key) return true;
  return !ctx.hiddenNavKeys?.includes(entry.key);
}
