import { sameDepartment } from "./compareDepartment";

/** A head's sub_department set to this sentinel covers every sub-department. */
export const ORG_WIDE_SUB_DEPARTMENT = "ALL";

/** A head's department set to this sentinel covers the whole organisation. */
export const ORG_WIDE_DEPARTMENT = "SUPER ADMIN";

/**
 * Resolves which of `heads` an `employee` reports to.
 *
 * A head is checked as a sub-department head first — if the head has a real
 * (non-org-wide) sub-department, only an employee whose own sub-department
 * matches counts. Otherwise the head is checked as a department head, which
 * an org-wide head can never be. Returns every match, in `heads` order;
 * callers decide what to do with more than one.
 */
export function resolveDepartmentHeads(employee, heads) {
  if (!employee || !Array.isArray(heads)) return [];

  const empSubDept = employee.sub_department;
  const empDept = employee.department;

  return heads.filter((head) => {
    if (empSubDept && head.sub_department && head.sub_department.toUpperCase() !== ORG_WIDE_SUB_DEPARTMENT) {
      return sameDepartment(head.sub_department, empSubDept);
    }
    if (empDept && head.department?.toUpperCase() !== ORG_WIDE_DEPARTMENT) {
      return sameDepartment(head.department, empDept);
    }
    return false;
  });
}

/**
 * Resolves the heads who cover every department — a fallback for an
 * employee that no specific head matched.
 */
export function resolveOrgWideHeads(heads) {
  if (!Array.isArray(heads)) return [];

  return heads.filter(
    (head) =>
      head.is_super_admin ||
      head.sub_department?.trim().toUpperCase() === ORG_WIDE_SUB_DEPARTMENT ||
      head.department?.trim().toUpperCase() === ORG_WIDE_DEPARTMENT,
  );
}
