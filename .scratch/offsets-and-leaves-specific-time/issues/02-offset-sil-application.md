# 02: Offset and SIL Leaves Application

**What to build:** Employees can file Offset and SIL leaves using start/end times instead of hours. The forms show derived hours, overnight shifts are correctly rejected, the backend persists them, and the employee's leave history lists display the window.

**Blocked by:** 01: Foundation & Overtime Application

**Status:** ready-for-agent

- [ ] Update pure time module to reject overnight shifts for Offset and SIL leaves.
- [ ] Update Offset and SIL application forms to accept start/end times and show derived hours.
- [ ] Update Offset and SIL application services to accept and persist start/end times.
- [ ] Update the employee's Offset and SIL leave history lists to display the formatted time window.
