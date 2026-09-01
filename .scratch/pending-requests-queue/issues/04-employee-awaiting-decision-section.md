# 04 — Employee "Awaiting decision" section on Self-Service lists

**What to build:** On the employee's own offsets/leaves page (Self-Service), each list tab — My Overtime and My Leaves — gains a small "Awaiting decision" section above the existing month-scoped list. This section shows that tab's own pending requests (using the dateless reads from ticket 01) across all time, ordered ascending by leave date (soonest first), scoped to that tab's request type only — My Overtime shows only pending overtime, My Leaves shows only pending offset/SIL leaves. The section is hidden entirely (not shown empty) when the employee has nothing outstanding for that tab.

The existing month-scoped list beneath each section is unchanged — it keeps using the floating picker and the existing period-scoped reads exactly as today. This ticket does not touch the picker on the employee page at all.

**Blocked by:** 01 (dateless pending reads)

**Status:** ready-for-agent

- [ ] The My Overtime tab shows an "Awaiting decision" section above its month-scoped list, containing only pending overtime requests.
- [ ] The My Leaves tab shows an "Awaiting decision" section above its month-scoped list, containing only pending offset-leave and SIL-leave requests.
- [ ] A pending request dated outside the currently selected period still appears in the relevant tab's "Awaiting decision" section.
- [ ] Requests within each "Awaiting decision" section are ordered ascending by leave date (soonest upcoming leave first).
- [ ] The "Awaiting decision" section on a tab is not rendered at all (no empty-state block) when the employee has no pending requests of that tab's type.
- [ ] The month-scoped list below each section continues to behave exactly as it does today — same data source, same picker behavior, unaffected by this change.
- [ ] A decided (approved/rejected), withdrawn, or cancelled request never appears in the "Awaiting decision" section.
