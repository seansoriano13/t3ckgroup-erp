# 02: Adopt `canEditSor` in ProcurementResolutionPanel

**What to build:** The UI (`ProcurementResolutionPanel`) correctly shows or hides edit controls based on the actual edit permissions determined by `canEditSor`, ensuring the frontend UI state matches database capabilities exactly.

**Blocked by:** 01: Extract `canEditSor` predicate function

**Status:** ready-for-agent

- [ ] Replace inline JSX boolean logic in `ProcurementResolutionPanel` with the `canEditSor` function.
- [ ] Update `ProcurementResolutionPanel.test.jsx` integration tests to assert that controls are shown/hidden correctly based on the new predicate.
