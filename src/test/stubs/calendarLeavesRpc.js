import { stubRpc } from "@/test/msw/server"
import { db } from "@/test/db/store"

/**
 * `get_calendar_offset_leaves` / `get_calendar_sil_leaves` (migration
 * 20260930340000, ADR 0012) are SECURITY DEFINER functions the fake database
 * does not execute. This re-implements their projection in JS against the
 * in-memory store: APPROVED rows plus the viewer's own, the date window, and
 * only the calendar fields — no reason, balances or signature.
 */
function stubCalendarLeavesRpc(name, table, { viewerId = null } = {}) {
  stubRpc(name, ({ p_start = null, p_end = null } = {}) => {
    const employees = db.internal.rowsOf("employees")
    const categories = db.internal.rowsOf("hr_leave_categories")

    return db.internal
      .rowsOf(table)
      .filter((l) => l.status === "APPROVED" || (viewerId && l.employee_id === viewerId))
      .filter((l) => (p_start == null || l.date >= p_start) && (p_end == null || l.date < p_end))
      .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))
      .map((l) => {
        const e = employees.find((row) => row.id === l.employee_id)
        const c = categories.find((row) => row.id === l.category_id)
        return {
          id: l.id,
          employee_id: l.employee_id,
          date: l.date,
          start_time: l.start_time,
          end_time: l.end_time,
          hours: l.hours,
          status: l.status,
          leave_group_id: l.leave_group_id,
          employee: {
            id: e?.id ?? null,
            name: e?.name ?? null,
            department: e?.department ?? null,
            avatar_path: e?.avatar_path ?? null,
          },
          category: c ? { label: c.label } : null,
        }
      })
  })
}

export const stubCalendarOffsetLeavesRpc = (options) =>
  stubCalendarLeavesRpc("get_calendar_offset_leaves", "offset_leaves", options)

export const stubCalendarSilLeavesRpc = (options) =>
  stubCalendarLeavesRpc("get_calendar_sil_leaves", "sil_leaves", options)
