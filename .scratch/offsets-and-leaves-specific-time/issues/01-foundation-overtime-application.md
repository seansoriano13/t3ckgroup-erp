# 01: Foundation & Overtime Application

**What to build:** The database schema is updated with `start_time` and `end_time` columns, the core time math module is written, and employees can file overtime using start/end times. The overtime form shows the derived hours live (allowing overnight shifts), the backend persists the times, and the employee's history list displays the window.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Add `start_time` and `end_time` TIME columns to overtime, offset, and SIL request tables via migration.
- [ ] Implement pure time module to derive hours from window (allowing overnight) and format windows.
- [ ] Update overtime application form to accept times and show live derived hours.
- [ ] Update overtime application service to accept and persist start/end times.
- [ ] Update the employee's overtime history list to display the formatted time window.
