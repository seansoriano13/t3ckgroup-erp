---
name: T3CKGROUP ERP — TG-11/TG-12 printed forms
description: Warm-neutral monochrome print system for the generated leave/Offset/overtime forms, drawn as HTML/CSS and printed via the browser's own print dialog.
colors:
  ink: "#221F1A"
  ink-2: "#4A463F"
  ink-3: "#6E6A61"
  rule: "#C6C1B8"
  hair: "#E3E0D9"
  well: "#F2F0EA"
  qr-black: "#000000"
typography:
  serif-name:
    fontFamily: "Spectral, Georgia, serif"
    fontSize: "18.75pt"
    fontWeight: 500
    letterSpacing: "-0.017em"
  sans-label:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "5.6pt"
    fontWeight: 700
    letterSpacing: "0.155em"
    textTransform: "uppercase"
  sans-value:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "9.4pt"
    fontWeight: 700
  mono-audited:
    fontFamily: "Geist Mono, ui-monospace, monospace"
    fontSize: "7.1pt"
    fontWeight: 400
spacing:
  content-margin: "30pt"
  section-gap: "11.25pt"
  grid-gap: "15pt"
components:
  sig-plate-wet:
    backgroundColor: "{colors.well}"
    textColor: "{colors.ink-3}"
  sig-plate-signed:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
---

## Overview

Two printed HR forms — TG-11 (leave/Offset applications) and TG-12 (overtime authorization) — rendered directly from live records as HTML/CSS, at exactly half a US Letter sheet (8.5 × 5.5 in, landscape) so two tile onto one printed page. HR composes and previews a batch in the Document Center (`src/pages/hr/offsets/components/DocumentCenterTab.jsx`), and the same HTML that renders the on-screen preview is what the browser's print dialog receives — there is no separate conversion step. The system replaces a hand-filled paper slip: everything on the sheet is pre-filled from the record that generated it, and a QR code resolves back to that record's live status.

This document covers only the printed-forms surface (`src/lib/pdf/`). The app's own screen UI is a separate, already-established Radix Colors system (`src/styles/radix-theme.css`) that was not part of this design pass and is not documented here.

**Source of truth**: a reviewed HTML design mockup (provided by the user, not committed to the repo) fully specified this system before implementation — this is a faithful, code-led rebuild of that mockup, not an original direction chosen this session. An earlier pass rebuilt it a second time into `pdf-lib` draw calls as a parallel generation path; that path was never wired into the app and has since been removed, leaving the direct HTML/CSS rendering (`src/lib/pdf/htmlPrinter.js`) as the one live pipeline.

## Colors

Four ink densities on white paper, no fifth, and no hue anywhere — chosen so the sheet stays legible after a photocopy and never depends on a printer having color toner.

| Token | Hex | Use |
|---|---|---|
| `ink` | `#221F1A` | Primary text: names, big figures, structural rule accents |
| `ink-2` | `#4A463F` | Secondary text: meta lines, org name, stamps |
| `ink-3` | `#6E6A61` | Tertiary text: field labels, helper copy, tracked captions |
| `rule` | `#C6C1B8` | Structural rules (masthead, head, signature plates) |
| `hair` | `#E3E0D9` | Subordinate hairlines (note divider) |
| `well` | `#F2F0EA` | Fill for a signature plate still awaiting a pen |
| `qr-black` | `#000000` | The QR code only — scanners need true-black contrast, never the ink ramp |

There are no boxes and no borders around figures; separation comes from rules and whitespace.

## Typography

Three faces, each with one job, never swapped:

- **Spectral** (serif) carries what a person *is*: the employee's own name, set at 18.75pt/500, the single largest and least tracked element on the sheet.
- **Geist** (sans) carries labels and system-supplied values: every field key is Geist Bold at 5.6pt, uppercase, tracked 0.155em; values are Geist Bold at ~9.4pt, untracked.
- **Geist Mono** carries anything payroll would audit: record numbers, dates, hours, balances, signing timestamps. If a figure is set in mono, a machine is accountable for it.

Tracking is plain CSS `letter-spacing`, set directly in `src/lib/pdf/htmlPrinter.js`'s stylesheet. This is load-bearing, not decorative: nearly every label on the sheet depends on it to read as a key rather than a second value.

## Layout

Fixed geometry, not responsive — this is a physical sheet at 612×396pt (72dpi), padded 21pt top / 30pt sides / 15pt bottom.

- **Masthead**: mono logo mark + org name (left), record type and number (right), one structural rule below.
- **Record head**: form kind + employee name (serif) + role/department meta (left); the big audited figure — hours applied/approved, with a ledger or requested-vs-credited line beneath it (right).
- **Body**: a 3-column field grid plus a remarks paragraph (left, ~68% width); an adjudication rail — outcome and HRD validation rows (right, fixed 160.5pt).
- **Accountability band**: signature plates (2 on TG-11, 3 on TG-12) plus a QR + verification URL, pinned above a filing-deadline note at the sheet's bottom edge.

Two sheets stack onto one Letter page with a dashed cut line between them. Pairing is order-driven — `pairIntoSheets` (`src/lib/pdf/layout.js`) takes an ordered list of records and returns sheets two at a time, so the print order HR sets in the Document Center's tray is exactly the physical pairing that comes out of the printer; an odd-count run fills its spare half with a blank form of the matching type rather than wasting the sheet.

## Shapes

No rounded corners, no card chrome — the sheet is rules on paper. The one circular mark is the 5×5pt outcome dot (`page.drawEllipse`) beside the outcome label.

## Components

- **Signature plate** (`sigBlock()` in `src/lib/pdf/htmlPrinter.js`), one shared renderer for both templates, three states:
  - `signed`: bare paper, the actual stored signature image embedded, a mono stamp naming when and against which stored version it was signed.
  - `legacy`: bare paper (the record is settled, not awaiting anything), the signer's name in place of an image, a plain "Signed on paper" note — for records that predate the signing feature.
  - `wet`: always toned `well`, always "SIGNATURE REQUIRED" — for a role that never signs digitally in this system (the immediate supervisor, an approving officer), because the system can never confirm ink was actually applied. A wet plate with no configured name is omitted entirely rather than printed blank.
- **Field grid item**: tracked-caps label + bold value + optional muted note (e.g. day count), auto-flowing 3-up; shrinks a value's font size rather than wrapping when it doesn't fit its column.
- **HRD validation row**: label left / bold value right, four rows max — the ceiling this system was drawn to.

## Do's and Don'ts

- **Do** derive every printed figure from the record itself — the balance ledger, the record number's year, the filed-on-time status are all computed from stored fields, never a second source that could drift.
- **Do** treat a wet-ink plate identically every time it's printed, regardless of whether a prior printout was actually signed on paper — the system cannot know, so it always prompts.
- **Don't** print a field the schema doesn't back (no fabricated employee number, no invented "schedule" flag) — an unavailable mockup field is dropped from the grid, not filled with a placeholder.
- **Don't** reuse this warm-neutral monochrome system for on-screen UI — it belongs to the printed-forms surface only; the app shell keeps its own Radix Colors system.
- **Don't** add a fifth ink density or any hue to the ramp — four densities is the ceiling this system was built to.
