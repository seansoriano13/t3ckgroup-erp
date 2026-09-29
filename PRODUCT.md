# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Internal T3CK Group employees only — not sold or shown to outside customers. Three operating postures on the same accounts, gated by role/capability flags rather than separate apps:

- **Every employee**, in Self-Service: applies for leave, Offset, and overtime; logs personal tasks; tracks their own schedule.
- **Supervisors, department heads, and HR staff (including HR Assistants holding the dedicated `can_manage_leaves` capability, not just the HR head)**, in the Approval Center and HR Modules: review and act on pending queues, approve/reject leave and overtime, manage the Employee Directory, print HR forms.
- **Super Admins**: full administrative access, including granting capabilities like `can_manage_leaves` to other employees.
- **Sales Flow editors**: the Flow Canvas is open to every employee (per user, 2026-09-19). `CONTEXT.md` describes it as the developer and Operations building flows together on staging; treat the wider access as confirmed.
- **Purchasing staff**, holding the Purchasing access flag (granted per employee, never inferred from `department`): work Purchase Requests, the Procurement Queue, and the Purchasing Dashboard.

One narrow exception to "internal only": a printed form's QR verification link (`/verify/:token`) is a public, unauthenticated route — anyone holding a physical printout (an auditor, a bank, a future employer) can confirm it matches a live record, without ever needing an account.

## Product Purpose

The operational system and ERP portal for T3CK Group, consolidating task workflows, workforce management (HR), sales (SORS: the SOR Register and every SOR's journey through its Sales Flow), purchasing, and commission into one system so the business runs on live records instead of parallel paper/spreadsheet processes. Success means a workflow that used to require a physical form, a spreadsheet, or a side-channel message instead happens inside the system, with the system's own record as the source of truth.

## Positioning

Built exactly to this company's own workflows, terminology, and paper trail — not generic HR/CRM software adapted to fit. Domain vocabulary (Offset, SOR, SORS, Sales Flow, Stage, Commission Pool, Self-Service, Approval Center) comes from how T3CK Group actually talks about its own operations, documented in `CONTEXT.md`, and features exist because a specific real process needed them (e.g. the printed TG-11/TG-12 forms exist because HR's paper process specifically requires them for payroll filing, not because "forms" are a generic feature).

## Operating Context

- Sales staff register SORs (Sales Opportunity Registration, named by Policy CCPR-2026-001, Annex C) and move them through **SORS**. Each SOR's Sale Type picks its **Sales Flow**: a directed graph of Stages (loops, skips, branches allowed), configured by the business, not fixed in code. Sale Types start empty; the system proposes none.
- The **Flow Canvas** is a long-lived editing surface, not a one-time build: flows keep changing after launch. Each Publish freezes a versioned **Flow Snapshot** (`vX.Y`); live SORs stay pinned to the snapshot they were registered against. Stages can carry Stage Fields, Stage Actions (which open tasks or Purchase Requests), Stage Conditions, and a per-Sale-Type Registration Form.
- **Stage-scoped visibility**: a Restricted Stage shuts parts of the Deal Team out of an SOR's data at that Stage (they see only that it is there and for how long); Stage Participants are called in with a time window. Super Admins are never shut out.
- **Retail SORs** (Shopee, Lazada, other marketplace orders synced from Odoo) are real SORs but run no Sales Flow, are excluded from pipeline, commission, and aggregates, and live on their own Retail screen.
- **Scratch SORs** exist only to exercise a Sales Flow; excluded from every register, dashboard, and commission total.
- HR runs leave, Offset (compensatory time), overtime, and employee records through the system; balances move automatically on approval.
- **HR's paper process is still partly physical**: an approved leave/Offset/overtime application is currently re-transcribed by hand onto a pre-printed slip (TG-11 for leave/Offset, TG-12 for overtime authorization), signed in ink, and walked to HR for payroll filing — even though every fact on that slip already exists in the system. This ERP is in the process of generating that printed artifact directly from the record instead (see the TG-11/TG-12 form-template work).
- **Purchasing** (never "Procurement" as the Module name): one Purchase Request per SOR, opened by a Stage Action, with Requested Items, members, a Buyer, and its own Chat; the cross-SOR Procurement Queue; and the Purchasing Dashboard grouping all buying by what is outstanding (To source, To price, To order, On order, To check). Odoo holds the purchase orders. Purchasing is not a Sales Flow (ADR 0023).
- **Commission Dashboard**: live Realized/Projected Commission Pool across SORs. Privacy Masking means standard employees see only their own ₱ values and relative splits; peer earnings and company totals are shown only to Super Admin, Management, and Finance & Accounting. The pool is always an estimate; there is no payout mechanism.
- Group Tasks and Individual Tasks share the same employee/role model.
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
- Domain terminology is binding and documented in `CONTEXT.md` (e.g. always **Offset**, never "leave credit" or "OT slip"; **SOR**, never "Opportunity" or "Deal" standalone; **SORS**, never "CRM"; **Purchasing**, never "Procurement" as the Module; **Approval Center**, never "Approvals Tab").

## Evidence on Hand

- `CONTEXT.md` — the project's own domain glossary; binding terminology for anything user-facing.
- `docs/testing.md` — testing-tier conventions.
- A reviewed design mockup for the TG-11 (Leave/Offset) and TG-12 (Overtime) printed forms, held outside the repo. It is already built, and `src/lib/pdf/htmlPrinter.js` is now the authority for that surface. Its written spec was in `DESIGN.md` until 2026-09-19 (see git history); `DESIGN.md` now documents the screen UI only.
- `docs/adr/`: binding decisions (e.g. 0009 primary-color usage, 0019 one Flow Canvas editing surface, 0021 Stage-scoped SOR visibility, 0023 Purchasing is not a Sales Flow, 0024 SORS not CRM).
- Odoo is an external system of record for Companies, Sales References, and purchase orders; the ERP reads from and syncs with it.
- No customer testimonials, case studies, or external marketing evidence exist or are needed — this is an internal tool with no marketing surface.

## Product Principles

1. **The system is the record; paper is a rendering of it.** Where a physical artifact (a signed leave slip, a printed authorization) is still required by an external process (payroll filing), it is generated from the live record and can be verified back against it — never a second, independently-maintained copy of the truth.
2. **Terminology tracks how the business actually talks**, not generic software conventions — Offset, SOR, Approval Center, Self-Service are the project's own words, documented and defended in `CONTEXT.md`.
3. **Capabilities are granted deliberately, not inherited as a side effect.** A broad flag (`is_hr`) is not reused to gate a narrower privilege; a dedicated capability is added and explicitly assigned.
4. **Live database state is verified, not assumed**, given this repo's own documented history of schema/ledger drift between environments.
5. **Tests run against a fake Supabase built from the repo's real SQL**, so schema and query-shape mistakes are caught without needing a live database for every run.

## Accessibility & Inclusion

No project-specific accessibility standard has been established; none established as of 2026-09-19.
