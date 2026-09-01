# 03 — HR Pending Requests becomes an unbounded, filterable queue

**What to build:** On the HR Leaves & Overtime Manager page, the Pending Requests tab stops being scoped to whatever period the floating picker happens to be set to. It shows every outstanding overtime, offset-leave and SIL-leave request across all time — using the dateless reads from ticket 01 — grouped under month headers, ordered ascending by leave date (earliest/most-urgent first, not by when it was filed). The tab's count badge (`Pending Requests (n)`) always counts total outstanding, unfiltered, so it can never read a low or zero count while requests genuinely wait.

Because the queue is no longer period-scoped, the floating period picker hides itself on this tab (via the hide/show mechanism from ticket 02), and a period filter dropdown — All time (default) / This month / Next month / Overdue — takes its place in the existing toolbar, alongside the current employee-name search and leave-type filter. "Overdue" means the request's leave date has already passed. When the period filter (or the existing type/search filters) is actively narrowing the list, the table shows a line above it: `Showing 4 of 27 pending requests` — never shown when nothing is narrowed.

The calendar board and Decision History tabs are explicitly unaffected: they keep using the picker and the existing period-scoped reads exactly as today.

**Blocked by:** 01 (dateless pending reads), 02 (picker hide/show wiring)

**Status:** ready-for-agent

- [ ] The Pending Requests tab shows pending requests dated in any month, not only the period selected by the floating picker.
- [ ] A request filed this month for a future month's leave date appears in the Pending tab immediately.
- [ ] A request from a past month that was never actioned still appears in the Pending tab.
- [ ] Pending requests are grouped under visible month headers (e.g. "March 2026", "April 2026").
- [ ] Within and across groups, requests are ordered ascending by leave date — the earliest/most overdue leave date is first.
- [ ] The `Pending Requests (n)` tab badge always shows the total count of all outstanding requests, regardless of any active filter — it never reflects a filtered subset.
- [ ] The floating period picker is hidden while the Pending tab is active.
- [ ] The floating period picker reappears when switching to the Calendar or Decision History tab.
- [ ] A period filter control (All time / This month / Next month / Overdue) is present in the Pending tab's toolbar, defaulting to All time.
- [ ] Selecting "Overdue" shows only pending requests whose leave date has already passed.
- [ ] Selecting "This month" or "Next month" narrows to pending requests whose leave date falls in that month.
- [ ] The existing employee-name search and leave-type filters continue to work in combination with the new period filter.
- [ ] When any filter narrows the visible list below the total pending count, a line reading `Showing X of Y pending requests` is shown; it is not shown when the filtered count equals the total.
- [ ] The Calendar tab still shows only the period selected via the floating picker, unchanged from current behavior.
- [ ] The Decision History tab still shows only the period selected via the floating picker, unchanged from current behavior.
- [ ] A page-level test confirms: a request dated in a future month appears in the Pending tab while the Calendar tab (on the currently selected/default month) does not show it as part of that month's data.
