# ADR 0014 — HTML Rendering Pipeline for HR Forms (TG-11 / TG-12)

## Status

Accepted — supersedes the rendering approach described in issue #59.

## Context

Issue #59 specified a fixed-geometry PDF renderer for the TG-11 (leave /
Offset application) and TG-12 (overtime authorization) forms. The forms
would be built in the browser with `pdf-lib`, drawing every text run and
rule at absolute pixel coordinates, embedding Geist TTF fonts via
`@pdf-lib/fontkit`. The reasoning was that print CSS varies across
browsers and operator machines, so only a byte-level renderer could
guarantee that a filed form comes out identical everywhere.

That renderer was built — four modules (`adapter.js`, `tg11.js`,
`tg12.js`, `signatureBox.js`) under `src/lib/pdf/` — and then
deliberately replaced with an HTML pipeline (commit `bcdb7b4`). The
replacement was motivated by two problems the coordinate approach created
in practice:

1. **Maintenance cost.** Every visual change — moving a label, adjusting
   spacing, adding a field — required recalculating absolute x/y
   coordinates across all four modules. CSS layout handles reflow
   naturally; coordinate drawing does not, and the amount of arithmetic
   required for two full-page form templates made iteration slow and
   error-prone.

2. **Font-metric fragility.** `pdf-lib` measures text widths from the
   embedded font's metrics tables. When Geist shipped updated metrics in
   a minor release, text that had been manually positioned relative to
   other text shifted. The identical-output guarantee that justified the
   approach applied to a fixed set of font binaries, not to a living
   dependency.

The HTML pipeline went through a brief intermediate state where form HTML
was sent to `pdfendpoint.com` — a third-party conversion service — to
produce downloadable PDF files (via `src/lib/pdf/api.js`). That
integration was removed before the feature stabilized: the browser's own
"Save as PDF" print destination covers the file-output case without a
paid API or a network dependency, and sending the HTML to a third party
meant employee names, reasons, and base64-encoded signature images left
our infrastructure on every print — an unnecessary exposure for a payroll
document.

## Decision

TG-11 and TG-12 forms are rendered as HTML documents in the browser and
printed through the browser's native print dialog. No PDF library, no
external conversion service, and no server-side rendering step is
involved.

The pipeline has three layers:

| Layer | Module | Responsibility |
|-------|--------|----------------|
| View model | `src/lib/pdf/formViewModel.js` | Pure mapping from a raw record (plus HR form settings) to exactly the fields each template prints. No I/O. |
| Layout | `src/lib/pdf/layout.js` | Sheet pairing (two half-letter forms per letter page), category resolution, date arithmetic, overtime outcome mapping. No I/O. |
| Composition | `src/lib/pdf/htmlPrinter.js` | Builds a complete `<!DOCTYPE html>` document with inline styles, composes paired sheets, opens a new browser window, and calls `window.print()`. |

The Document Center tab (`src/pages/hr/offsets/_components/DocumentCenterTab.jsx`)
drives the pipeline: it hydrates records with QR codes and signature
images (`hydrateRecordsForPrint`), renders the composed document into an
`<iframe>` for live preview, and on print opens the same document in a
new window for the browser's print dialog.

### What happens when the external renderer is unreachable

There is no external renderer. The entire pipeline runs locally in the
browser. The only network dependency at print time is Google Fonts
(Geist, Geist Mono, Spectral), loaded via `fonts.googleapis.com` in the
composed HTML document. Browsers cache web fonts aggressively; if the CDN
is unreachable, the CSS font stack falls through to system fonts
(`ui-sans-serif, system-ui, "Segoe UI", Helvetica, Arial` for sans;
`ui-serif, Georgia, "Times New Roman"` for serif; `ui-monospace,
"SFMono-Regular", Consolas` for monospace). Forms remain printable — only
the typeface changes.

Signature images are fetched from Supabase Storage and embedded as
base64 data URIs before the document is composed, so a storage outage
during hydration would surface as a toast error in the Document Center,
not a silent gap in the printed form.

### Whether form content leaves our infrastructure

**No.** The HTML is composed entirely in the browser from data already
present in the client's Supabase session. QR codes are generated locally
by the `qrcode` npm package. Signature images are fetched from Supabase
Storage (where access is governed by row-level security policies on the
`signatures` bucket) and converted to base64 data URIs in the browser —
no image URL appears in the final document that a print service would
need to resolve.

The `pdfendpoint.com` integration that existed briefly (commit `bcdb7b4`,
configured via `VITE_PDFENDPOINT_API_KEY`) *did* send the full HTML —
including employee names, the free-text reason field, and base64-encoded
signature images — to a third-party server for conversion. That code
(`src/lib/pdf/api.js`) was removed. The API key remains in `.env` and
`.env.example` as a dead reference; nothing in the source imports or
reads it.

### Whether the identical-output guarantee still holds

It does not, in the strict sense #59 intended. The composed HTML is
deterministic — the same inputs always produce the same markup — but the
final rendering depends on the browser's print engine: font rasterization,
sub-pixel positioning, and page-break behavior are controlled by the
browser, not by the application.

In practice, all HR operators use Chrome on company-provisioned Windows
machines, so output is consistent within the fleet. The tradeoff is
explicit: the maintainability of CSS layout and the elimination of an
external service dependency were judged more valuable than a byte-identity
guarantee whose practical benefit was already limited to a homogeneous
browser environment.

What *is* guaranteed to be identical across machines is the **content**:
the view-model layer is pure and deterministic, the sheet-pairing order
is driven entirely by the tray's drag-and-drop order (persisted in
`localStorage`), and the QR verification codes resolve to the record's
live status regardless of which machine printed the form.

## Consequences

- `pdf-lib` and `@pdf-lib/fontkit` remain in `package.json` because the
  quotation letterhead module (`src/lib/pdfLetterhead.js`) still uses
  them to patch Odoo-rendered PDFs. They are no longer used for HR form
  rendering.

- The static Geist TTF font files that `@pdf-lib/fontkit` required for
  embedding are no longer needed by the HR pipeline. Google Fonts serves
  the same families to the composed HTML document at print time.

- The `VITE_PDFENDPOINT_API_KEY` environment variable is dead. It can be
  removed from `.env` and `.env.example` whenever those files are next
  touched for another reason; removing it is not urgent since nothing
  reads it.

- A future move to server-side rendering (e.g., a Supabase Edge Function
  running a headless browser) would restore the identical-output guarantee
  and also eliminate the signature-image exposure documented in #59's
  "Accepted limitation" section — HR's browser session would no longer
  need to fetch every employee's signature image. The HTML pipeline was
  designed with this migration path in mind: `buildPrintableDocument`
  produces a self-contained HTML string that any headless browser can
  consume without modification.
