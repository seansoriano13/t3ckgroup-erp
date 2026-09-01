## Problem Statement

The client-side authorization logic determining whether a user can edit a Statement of Requirements (SOR) on the purchasing side is currently implemented as an inline boolean expression in the JSX. This poses a significant risk: the client logic can easily drift out of sync with the actual `sor_update` Row Level Security (RLS) policy in the database, leading to inconsistent UI states where users might see edit buttons they cannot use or vice versa.

## Solution

Extract the inline authorization logic into a pure, assertable predicate function `canEditSor(user, sor)`. This function will exactly mirror the logic of the `sor_update` RLS policy, ensuring the client UI stays perfectly aligned with database permissions. 

## User Stories

1. As a purchaser, I want the UI to accurately reflect my editing permissions for an SOR, so that I don't attempt actions I'm not authorized to perform.
2. As a developer, I want client-side authorization checks to be isolated and easily testable, so that I can ensure they exactly match the database RLS policies without manual verification.
3. As a developer, I want to reuse the `canEditSor` check across different components, so that the permission logic isn't duplicated in multiple JSX files.

## Implementation Decisions

- **New Pure Predicate:** Create a new pure function `canEditSor(user, sor)` at the highest point possible in the application structure.
- **Mirror RLS:** The logic inside `canEditSor` will strictly mirror the `sor_update` RLS policy.
- **UI Integration:** Update the `ProcurementResolutionPanel` and any other relevant components to use this new predicate instead of inline boolean expressions.

## Testing Decisions

- **Pure Unit Tests:** The `canEditSor(user, sor)` predicate will have its own dedicated unit tests (new seam). These tests will assert all possible combinations of user roles/states and SOR states to guarantee it matches the RLS policy.
- **Integration Tests:** The existing `ProcurementResolutionPanel.test.jsx` (which runs against the fake DB) will continue to verify the integration tier, proving that the UI correctly reacts to the permissions.

## Out of Scope

- Modifying the actual `sor_update` RLS policy in the database.
- Refactoring the `ProcurementResolutionPanel` beyond updating the authorization check.

## Further Notes

This adds one small, pure, unit-tier seam. Keeping this authorization logic assertable is crucial for preventing silent drift between the frontend UI and backend security rules.
