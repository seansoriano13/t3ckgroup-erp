# 03: Overlap Prevention

**What to build:** An employee is prevented from double-booking themselves. The pure time module gains overlap logic, and all three application services check for and reject overlapping requests on the same date.

**Blocked by:** 02: Offset and SIL Leaves Application

**Status:** ready-for-agent

- [ ] Add overlap detection logic to the pure time module.
- [ ] Update `overtimeService`, `offsetService`, and `silService` to reject new requests that overlap with existing ones on the same date.
- [ ] Verify validation errors surface properly to the employee on the forms.
