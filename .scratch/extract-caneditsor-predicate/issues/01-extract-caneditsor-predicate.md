# 01: Extract `canEditSor` predicate function

**What to build:** A tested pure function `canEditSor(user, sor)` that exactly mirrors the database RLS policy for `sor_update`. This provides a single source of truth for edit permissions on the client side.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Create `canEditSor` pure function mimicking the `sor_update` RLS logic.
- [ ] Write unit tests for `canEditSor` covering various user roles and SOR states.
