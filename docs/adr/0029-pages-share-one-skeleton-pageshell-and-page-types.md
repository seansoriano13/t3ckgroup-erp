# Pages share one skeleton: PageShell and page types, enforced by lint

**Status:** accepted (2026-09-30)

Every Page (one sidebar entry) is built from one shared layout module,
**PageShell**, and belongs to one of five **page types** (Queue, Register,
Report, Config, Tool). A lint rule stops pages bypassing
PageShell. The rules themselves live in DESIGN.md, "Pages".

## Why

**Each redesign invented its own basics.** The Approval Center, Commission
Dashboard and Leaves Manager each chose their own title size, tab style, status
pill, section heading, record container and main button. Older pages add big
filter cards, gradient number cards and three empty states. Nothing in the
codebase said what a Page should look like, so every new redesign added a
variant, and a person who learned one page could not carry it to the next.

**A prose rule already failed once.** ADR 0025 hit the same problem at element
level ("use the shared primitives" did nothing until lint enforced it). Page
level is the same failure one layer up.

## Decision

**PageShell owns the skeleton.** Fixed slots, in fixed order: header (compact
title, description, the one main action), level-1 tabs, toolbar (level-2 pills,
filter bar, display toggle), body. A Page cannot reorder them. PageShell also
owns phone behaviour and dark-mode tokens. The page-header Primitive loses its
large size.

**Page type picks the frame and body pattern.** Centred or full-width frame;
queue table, register table, report, sidebar module, config form, or custom
tool surface. Full-width stays an explicit per-route list.

**Three containers, chosen by intent.** Slide-over to look at or decide on a
record; modal to make or confirm something short; RecordModal (one size) for
the records that carry a Chat.

**One form per small part.** Status badge, section heading, filter bar, empty
state, decision buttons and report figure each have exactly one look.

**Enforcement is mechanical.** A local ESLint rule, `local/require-page-shell`
(`src/lib/linting/require-page-shell.js`), next to `no-raw-html` and
`no-primary-decoration`, errors when a routed page renders the page-header
Primitive outside PageShell or renders no PageShell. It uses the same
refuse-disable processor, and the CI gate `pnpm lint:primitives` runs it. It is
switched on in the last step of the delivery branch, once no page breaks it.

**Delivery is one push.** Built step by step on one branch, each step checked in
a browser by the maintainer, then one merge to staging and prod. A bulk UI
change landing unseen was reverted before; this avoids repeating it.

## Trade-off

Pages lose freedom. A designer who wants a different title, tab style or
container for one Page must change the shared rule, not the Page. In return
every Page reads the same, and new Pages inherit the look for free. Tool pages
keep a custom body but share the header. Hard to reverse once every Page
depends on PageShell and lint enforces it.

The rule set is large, so a mistaken rule costs a sweep across many Pages. The
per-step browser review is the mitigation.

## Consequences

- Existing pages migrate to the skeleton in ordered steps (see #429). Layouts
  that differ today (pill level-1 tabs, filter cards, gradient cards, dot-pills)
  are replaced, not kept.
- The Commission Rates editor moves into the Commission Dashboard's Formula tab;
  the Super Admin Commission Pool page goes away.
- ADR 0009 is amended to allow green and pale red in decision footers.
- CONTEXT.md is unchanged: Page and page type are UI terms, not domain terms.

## Amendment (2026-09-30): no Sidebar module

The Leaves Manager was the only Page with a left sidebar, so the type was a
sixth preset with one user. Its views became level-1 tabs and its Type facet
level-2 pills, and "Who's out" moved to a header popover. The type is removed;
no Page has a sidebar of its own.
