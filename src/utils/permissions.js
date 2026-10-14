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
  const hasFinanceFlow = !!(user?.has_finance_flow ?? user?.hasFinanceFlow);
  // On a sign-off list (ipas_signer_lists); derived by employeeService.
  const isIpasSigner = !!(user?.is_ipas_signer ?? user?.isIpasSigner);
  // On the section 1 or 3 approval list (the Approval Center's IPAS queue).
  const isIpasApprover = !!(user?.is_ipas_approver ?? user?.isIpasApprover);
  // On a Transmittal staff list (#252): reads Transmittals and the nav entry.
  const isTransmittalStaff = !!(user?.is_transmittal_staff ?? user?.isTransmittalStaff);
  const hasRetailAccess = !!(user?.has_retail_access ?? user?.hasRetailAccess);
  const hasBugReportAccess = !!(user?.has_bug_report_access ?? user?.hasBugReportAccess);
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
    hasFinanceFlow,
    isIpasSigner,
    isIpasApprover,
    isTransmittalStaff,
    hasRetailAccess,
    hasBugReportAccess,
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

/**
 * Whether the person `ctx` describes may read every IPAS (the database's
 * `ipas_can_read`): Purchasing access, Finance access, a Super Admin, or
 * anyone on a sign-off list (`isIpasSigner` is the list members with no other
 * access, `isIpasApprover` any list member). The SOR's IPAS summary opens the
 * full IPAS only for these; everyone else it only informs. A screen's
 * convenience: the database refuses a non-reader whatever this says.
 */
export function canReadIpas(ctx) {
  return !!(ctx?.isSuperAdmin || ctx?.hasPurchasingFlow || ctx?.hasFinanceFlow || ctx?.isIpasSigner || ctx?.isIpasApprover);
}
