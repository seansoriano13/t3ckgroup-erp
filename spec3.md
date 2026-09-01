## Problem Statement

On the purchasing side of SOR (Sales Opportunity Record), we need to enforce who is allowed to edit a record. Currently, edit permissions (mirrored from the `sor_update` RLS policy) might be scattered or inlined as boolean expressions in JSX, increasing the risk that client-side UI falls out of step with the database's actual permissions.

## Solution

Extract the edit permission logic into a pure predicate function, `canEditSor(user, sor)`. This function exactly mirrors the database RLS policy for `sor_update`. We will use this function in the UI (e.g., `ProcurementResolutionPanel`) to determine whether to show edit controls. 

## User Stories

1. As a user on the purchasing side, I want to see edit controls only when I actually have permission to edit the SOR, so that I am not frustrated by clicking buttons that ultimately fail.
2. As a developer, I want a single pure function to determine edit permissions, so that I can easily assert the client logic matches the database RLS.

## Implementation Decisions

- **Pure Predicate:** Create a new pure module/function `canEditSor(user, sor)`. It will evaluate the rules mimicking the `sor_update` RLS policy.
- **UI Adoption:** `ProcurementResolutionPanel` and any other component needing to check edit permissions will call this function instead of using inline JSX booleans.

## Testing Decisions

- **Unit tier — `canEditSor`:** Assert the pure function behaves exactly as the RLS policy dictates for various combinations of user roles and SOR states. (This is a new small seam).
- **Integration tier — `ProcurementResolutionPanel` against the fake DB:** Assert that the panel correctly shows or hides edit controls based on the logged-in user and SOR data using the predicate. Tested against `ProcurementResolutionPanel.test.jsx`.

## Out of Scope

- Changes to the actual RLS policies in the database.
- Modifying the visual design of the Procurement Resolution Panel.

## Further Notes

Having this logic in an assertable function reduces the chance of drift between UI state and database enforcement. It is the thing most likely to silently drift out of step with the database, so it should be an assertable function rather than a boolean expression inlined in JSX.
