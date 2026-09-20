# One Primitive system in the shared UI folder, enforced by lint

**Status:** accepted and complete (2026-09-20). The migration finished with no baseline left; the suppression file is gone.

A **Primitive** is anything in `src/components/ui/`. For a defined set of HTML
elements, raw HTML is banned everywhere except inside that folder, and a lint
rule enforces the ban. This records why, so the next person who hits the rule
finds a reason instead of an `eslint-disable`.

## Why

**A prose rule was already there and did not work.** DESIGN.md said "use the
shared primitives before hand-rolling a variant". Outside the UI folder there
are still roughly 507 raw buttons, 135 inputs, 27 textareas, 22 selects, 17
tables, 135 labels, 13 images, 15 anchors and 12 hand-rolled full-screen
modals. AI agents, and sometimes people, write the raw element because it is
the shortest path and nothing stops them. Every one is a screen that looks and
behaves slightly differently, and each becomes cleanup work later.

**There was no single answer to "which one do I use".** Two button components
(Button, PrimaryButton), two modals (Dialog, ModalOverlay), a popover-style
Dropdown next to an unused real Select, and no Primitive at all for table,
checkbox, file input, image or external link. A rule that says "use the
primitive" is meaningless until there is exactly one.

## Decision

**Covered elements:** button, input (text, number, date, file, checkbox),
textarea, select, label, table, img, a, and hand-rolled full-screen modals.
Out of scope: layout tags, paragraphs, headings (a possible later typography
phase) and `<form>`, which has no visual identity.

**One Primitive per job.** Button (PrimaryButton deleted), Dialog (ModalOverlay
deleted), a new Select with `options` / `value` / `onChange`, FieldBox as the
form-field Primitive, a styling-only Table set, Input for date, FileInput,
Checkbox, Image, ExternalLink. Dropdown and FilterDropdown stay as the
popover/menu Primitives. The catalog lives in DESIGN.md, Components.

**Enforcement is mechanical.** A custom ESLint rule at `error`, exempting only
the shared UI folder by path. The message names the replacement Primitive and
links to its catalog heading. The rule refuses `eslint-disable` for itself in
feature code. A Claude Code hook lints each edited `.jsx` so an agent sees the
violation in the same turn. CI blocks on this rule even though the rest of the
lint step stays non-blocking on an unrelated backlog.

**Existing violations are frozen, then burned down.** ESLint bulk suppression
freezes the ~700 current violations so nothing new lands. Migration is one
slice per element type, each its own issue and PR, and each deletes its
suppressions. The suppression file is the authoritative measure of what remains.

**When no Primitive fits, stop and ask the maintainer.** The Primitive set
grows only when the maintainer decides. A new variant or size is added only when
the same custom look appears in three or more places.

## Consequences

- Migrated screens adopt the Primitive's look rather than keeping each raw
  element's one-off styling. The maintainer reviews visual change per slice on
  staging.
- Moved: FieldBox now lives in the UI folder, because its own <label> would otherwise
  need a permanent suppression. Avatar, StatusBadge, StatCard and ImageAttachment stay at
  the root: they contain no covered raw element. The folder keeps its mixed base-ui and
  custom files and mixed case.
- Added during the migration: Drawer, Checkbox, Slider, FileInput, Image, ExternalLink,
  Table, SwitchField and CheckboxField, each because no existing Primitive expressed a
  covered element. Category, Priority and Role pickers stay Dropdown-based (they need
  search), so they were not moved onto Select.
- Hard to reverse: once agents and CI rely on the ban, loosening it means
  re-opening the drift it removed.
