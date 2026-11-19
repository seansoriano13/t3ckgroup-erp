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

// "May 16, 4:00 PM": the short form for laptops and phones.
export function formatWhenShort(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

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

// What a System/SOR Logs row is about: the Venue, the label, or the quoted name
// in the message (Category "X"); an employee row falls back to the employee.
// Returns null when the row has none, so the caller keeps its own fallback.
export function systemLogSubject(entry, employees = []) {
  const meta = entry?.metadata || {};
  const named = meta.venue || meta.label || meta.title;
  if (typeof named === "string" && named.trim()) return named.trim();
  const quoted = /"([^"]+)"/.exec(entry?.content || "");
  if (quoted) return quoted[1];
  if (entry?.entityType === "EMPLOYEE") {
    return employees.find((e) => e.id === entry.entityId)?.name || null;
  }
  return null;
}

// A range typed backwards ("to" before "from") is swapped.
export function orderDateRange(from, to) {
  return from && to && to < from ? { dateFrom: to, dateTo: from } : { dateFrom: from, dateTo: to };
}
