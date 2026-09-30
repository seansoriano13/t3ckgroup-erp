// Dates are "YYYY-MM-DD" strings ("" = unset).
export const DEFAULT_LOG_FILTERS = {
  type: "ALL",
  authorId: "ALL",
  employeeId: "ALL",
  taskStatus: "ALL",
  dept: "ALL",
  subDept: "ALL",
  dateFrom: "",
  dateTo: "",
  search: "",
};

export function formatWhen(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
