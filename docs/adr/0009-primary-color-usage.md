# 9. Primary Color Usage Rule

Date: 2026-09-04

## Status

Accepted

## Context

A recent sweep across roughly twenty components removed primary-tinted focus rings and accent backgrounds in favour of neutral tones. The intent was correct, but the execution was flawed (a bulk find-and-replace left orphaned ring utilities and duplicated class names), leading to a revert. However, the design decision behind it remains valid: the primary color (red) should not be used for incidental decoration.

Currently, the primary color is frequently used for focus rings, hover tints, and accent backgrounds on ordinary controls. This excessive use of red creates visual noise and diminishes the semantic value of the color. Red should be reserved for elements that require immediate attention or carry significant consequences, such as primary actions and destructive confirmation dialogs.

To prevent the gradual reintroduction of primary-tinted decorations, we need an automated way to enforce this design decision at the time of writing code, without blocking development or adding friction to legitimate use cases.

## Decision

We will restrict the use of primary-color utilities (`bg-primary`, `text-primary`, `ring-primary`, `border-primary`, etc.) to an allowlist of components where the color carries genuine meaning (e.g., buttons, destructive confirmations).

This rule will be enforced via a custom ESLint rule (`no-primary-decoration`), which will run as a warning.

1.  **Scope**: The rule targets utilities that apply the primary color to borders, backgrounds, text, and rings, including state modifiers like `hover:` or `focus-visible:`.
2.  **Allowlist**: Components like `Button` or specific files where primary color usage is deliberate are excluded from the warning.
3.  **Enforcement**: The lint rule is set to `warn`, meaning it will appear in the editor as feedback while typing but will not block commits, merges, or builds. This matches the repository's approach to application linting.

## Consequences

-   **Consistent Visuals**: The UI will rely more on neutral tones for focus states and secondary accents, reserving red for true primary and destructive actions.
-   **Immediate Feedback**: Developers will be warned in their editor when they accidentally apply a primary-tinted utility to an ordinary component.
-   **No Blockers**: Legitimate exceptions can be made by adding them to the allowlist or ignoring the warning, without breaking the build pipeline.
-   **Follow-up Work**: The twenty components from the reverted sweep will need to be manually updated to use neutral utilities in a separate, focused effort.

## Amendment (2026-09-30): decision footers

Status: accepted. See ADR 0029.

The pinned decision footer of a slide-over may use green (approve, verify) and
pale red (return, reject) buttons, so the outcome of each button is clear from
its colour. Nowhere else. Every other main action stays the single Signal Red
Button in the page header at the standard 32px size. Oversized, uppercase, black
and floating main-button variants are removed. The `no-primary-decoration` rule
is unchanged: green and pale red are not primary-color utilities.
