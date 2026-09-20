# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Internal T3CK Group employees only — not sold or shown to outside customers. Three operating postures on the same accounts, gated by role/capability flags rather than separate apps:

- **Every employee**, in Self-Service: applies for leave, Offset, and overtime; logs personal tasks; tracks their own schedule.
- **Supervisors, department heads, and HR staff (including HR Assistants holding the dedicated `can_manage_leaves` capability, not just the HR head)**, in the Approval Center and HR Modules: review and act on pending queues, approve/reject leave and overtime, manage the Employee Directory, print HR forms.
- **Super Admins**: full administrative access, including granting capabilities like `can_manage_leaves` to other employees.

One narrow exception to "internal only": a printed form's QR verification link (`/verify/:token`) is a public, unauthenticated route — anyone holding a physical printout (an auditor, a bank, a future employer) can confirm it matches a live record, without ever needing an account.

## Product Purpose

The operational system and ERP portal for T3CK Group, consolidating task workflows, workforce management (HR), sales opportunity tracking (SOR), and procurement into one system so the business runs on live records instead of parallel paper/spreadsheet processes. Success means a workflow that used to require a physical form, a spreadsheet, or a side-channel message instead happens inside the system, with the system's own record as the source of truth.

## Positioning

Built exactly to this company's own workflows, terminology, and paper trail — not generic HR/CRM software adapted to fit. Domain vocabulary (Offset, SOR, Commission Pool, Self-Service, Approval Center) comes from how T3CK Group actually talks about its own operations, documented in `CONTEXT.md`, and features exist because a specific real process needed them (e.g. the printed TG-11/TG-12 forms exist because HR's paper process specifically requires them for payroll filing, not because "forms" are a generic feature).

## Operating Context

- Sales staff register and track deals through the SOR pipeline (Sales Opportunity Record) from lead through Awarded, PO, delivery, collection, and commission.
- HR runs leave, Offset (compensatory time), overtime, and employee records through the system; balances move automatically on approval.
- **HR's paper process is still partly physical**: an approved leave/Offset/overtime application is currently re-transcribed by hand onto a pre-printed slip (TG-11 for leave/Offset, TG-12 for overtime authorization), signed in ink, and walked to HR for payroll filing — even though every fact on that slip already exists in the system. This ERP is in the process of generating that printed artifact directly from the record instead (see the TG-11/TG-12 form-template work).
- Procurement, Group Tasks, and Commission Pool are adjacent modules with their own registers and approval flows, sharing the same employee/role model.
- The system is used during normal business hours on desktop by office/admin staff; there is no evidence of field or mobile-first use.

## Capabilities and Constraints

- **Stack**: React 19 + Vite + `@generouted/react-router` (file-based routing) + Tailwind CSS + Radix Colors/Radix UI primitives, backed by Supabase (Postgres, Auth, Storage, RLS). PDF generation uses `pdf-lib` + `@pdf-lib/fontkit` (client-side, no server-side rendering).
- **Testing**: a pyramid (unit/integration/e2e) run against an in-memory fake of Supabase built from the repo's own SQL migrations — no live DB needed for tests, documented in `docs/testing.md`.
- **Role/capability model**: coarse flags (`is_super_admin`, `is_hr`, `is_head`) plus narrower dedicated capabilities (e.g. `can_manage_leaves`) added deliberately rather than overloading a broad flag, gated by a role-escalation trigger in Postgres.
- **This repo has a documented history of the live database schema drifting from the migrations directory** in both directions — staging and production have each been found stopped at different migration versions, or running a live function body that matches neither migration file. Live schema state must be verified directly, not assumed from the migrations ledger.
- **PDF constraint**: `pdf-lib` embeds TrueType, not the variable/woff2 fonts this project's font packages ship — printed-form typography requires static `.ttf` files fetched at render time, already in place under `public/fonts/`.

## Brand Commitments

- Name: **T3CKGROUP** / **T3CK Group**. Two logo assets exist at `public/tg-logo.svg` (full-color brand mark, red `#c70908` + neutral grey) and `public/tg-logo-mono.svg` (a `currentColor` variant with the counter-form dropped to 28% opacity, for single-ink/monochrome contexts like the printed forms).
- Color system: Radix Colors (`@radix-ui/colors`), themed via `src/styles/radix-theme.css` — the app's screen UI is not the warm-neutral monochrome world of the TG-11/TG-12 print mockup; that palette is scoped to the printed-forms surface, not a site-wide rebrand.
- Domain terminology is binding and documented in `CONTEXT.md` (e.g. always **Offset**, never "leave credit" or "OT slip"; **SOR**, never "Opportunity" or "Deal" standalone; **Approval Center**, never "Approvals Tab").

## Evidence on Hand

- `CONTEXT.md` — the project's own domain glossary; binding terminology for anything user-facing.
- `docs/testing.md` — testing-tier conventions.
- A reviewed design mockup/prototype for the TG-11 (Leave/Offset) and TG-12 (Overtime) printed forms exists at the path the user supplied this session (outside the repo, in a scratch location) — treated as committed visual authority for that surface once `new-work` runs.
- No customer testimonials, case studies, or external marketing evidence exist or are needed — this is an internal tool with no marketing surface.

## Product Principles

1. **The system is the record; paper is a rendering of it.** Where a physical artifact (a signed leave slip, a printed authorization) is still required by an external process (payroll filing), it is generated from the live record and can be verified back against it — never a second, independently-maintained copy of the truth.
2. **Terminology tracks how the business actually talks**, not generic software conventions — Offset, SOR, Approval Center, Self-Service are the project's own words, documented and defended in `CONTEXT.md`.
3. **Capabilities are granted deliberately, not inherited as a side effect.** A broad flag (`is_hr`) is not reused to gate a narrower privilege; a dedicated capability is added and explicitly assigned.
4. **Live database state is verified, not assumed**, given this repo's own documented history of schema/ledger drift between environments.
5. **Tests run against a fake Supabase built from the repo's real SQL**, so schema and query-shape mistakes are caught without needing a live database for every run.

## Accessibility & Inclusion

No project-specific accessibility standard has been established; no material gap surfaced during this session.
