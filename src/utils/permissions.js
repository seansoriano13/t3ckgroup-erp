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
  };
}
