# Print pipeline (ADR 0014) and the printed-costing-matrix prototype (#229)

## ADR 0014 in one paragraph

`docs/adr/0014-html-rendering-pipeline-for-hr-forms.md`: forms are composed as a complete HTML
document in the browser and printed through `window.print()` ("Save as PDF" covers file output).
No PDF library, no external renderer, no server. Three layers: **view model** (pure, raw record →
exactly what prints), **layout/document** (pure, view model → HTML string), **printer** (I/O:
fetch, hydrate signatures as base64 data URIs, open window, print). Fonts from Google Fonts
(Geist, Geist Mono, Spectral) with system fallbacks. Content leaves nothing: signature images are
fetched from Supabase Storage and embedded as data URIs.

## Modules — `src/lib/pdf/`

| File | Role |
|---|---|
| `formTypeRegistry.js` | `FORM_TYPES[type] = { buildViewModel, markPrinted }`; `getFormType(type)` throws `Unknown form record type: "X"` |
| `formViewModel.js` | HR TG-11/12/13 builders (`buildTG11ViewModel(record)` → `{ recordNo, formLabel, kind, name, fields, sigs, ... }`) |
| `htmlPrinter.js` | HR half-sheet composer (`formHTML`, `buildPrintableDocument`, `@page { size: letter portrait }`), plus shared `printIntoWindow(win, html)` (write, wait 750 ms for fonts, print), `openPrintWindow(label)`, `blobToDataUrl(blob)` |
| `sigBlock.js` | `sigBlock(s)` shared signature plate; `escapeHtml(value)` |
| `brandMark.js` | `MARK` (the T3CK SVG) |
| `ipasViewModel.js` / `ipasDocument.js` / `ipasPrinter.js` | IPAS: two A4 portrait pages |
| `packingListViewModel.js` / `packingListDocument.js` / `packingListPrinter.js` | one A4 sheet |
| `transmittalViewModel.js` / `transmittalDocument.js` / `transmittalPrinter.js` | TG03 |
| `tsrViewModel.js` / `tsrDocument.js` / `tsrPrinter.js` | TSR |

## Adding a form type (what IPAS / Packing List / Transmittal / TSR each did)

1. `xxxViewModel.js`: `export function buildXxxViewModel(record, opts)` — pure; formats amounts
   and dates to strings (`printAmount(value, currency)` → "PHP 36,160.00", `printDateTime`,
   `printDate` in company timezone — exported from `ipasViewModel.js`); builds signature boxes.
2. `xxxDocument.js`: `export const CSS = \`...\``, page functions, and
   `export function buildXxxDocument(vm)` returning `<!DOCTYPE html>…<style>${CSS}</style>…`.
   Escape every string (`escapeHtml as esc` from `./sigBlock`) — `sigBlock` itself doesn't.
3. `xxxPrinter.js`: `openXxxPrintWindow()` (call synchronously in the click, popup blockers),
   `prepareXxxForPrint(id, opts)` (service read → view model → hydrate signatures),
   `printXxx(id, { printWindow })` → `printIntoWindow(printWindow, buildXxxDocument(vm))`, and on
   failure close the window and rethrow.
4. Registry entry in `formTypeRegistry.js`:
   ```js
   // Issue #250: ... Printing an IPAS stamps nothing ... markPrinted is a no-op.
   IPAS: { buildViewModel: buildIpasViewModel, markPrinted: async () => {} },
   ```
   and a case in `formTypeRegistry.test.js` (`expect(getFormType('IPAS').buildViewModel).toBe(buildIpasViewModel)`).
5. Tests in the **logic** project: `xxxViewModel.test.js`, `xxxDocument.test.js`
   (e.g. `ipasViewModel.test.js` 414 lines, `ipasDocument.test.js`, `ipasPrinter.test.js`).
6. Print button on the record page: `src/pages/purchasing/ipas/[id].jsx` l.~700
   (`const printWindow = openPrintWindow(); ... printIpas(id, { printWindow, filingCopy, printedBy: user?.name ?? null })`);
   page test `src/test/pages/ipasPrintPages.test.jsx`.

## Landscape

**No existing form prints landscape.** Every composer sets portrait: HR `@page { size: letter portrait; margin: 0; }`
(htmlPrinter.js l.84); IPAS `@page { size: A4 portrait; margin: 0; }` (ipasDocument.js l.42),
`.sheet { width: 210mm; min-height: 296mm; ... }`, `.sheet.first { break-after: page; page-break-after: always; }`.
Landscape is a CSS choice in the new document (`@page { size: A4 landscape; margin: 0; }`, sheet
297mm × 210mm) — the prototype already does this in `@media print`.

## Signature blocks

`sigBlock(s)` (`src/lib/pdf/sigBlock.js`), `s = { role, who, title, state, signatureBase64?, stamp? }`:
- `state` `'wet'` or `'awaiting'` → dashed plate, `<div class="pending">Signature required</div>`.
- otherwise with `signatureBase64` → `<img src=...>` in the plate; without → `<div class="printed-name">who</div>`
  (name only); `stamp` text or `"signed on paper"`.
IPAS box builder `signoffBox(role, section, signoff)` (`ipasViewModel.js` l.133):
- no live sign-off → `{ role, who: '', title, state: 'awaiting', signaturePath: null }`;
- else `signaturePath = declined ? null : signoff.signatureVersion`; stamp
  `e-signed <when>` | `signed <when> · signature not applied` (declined) |
  `signed <when> · name only, no signature on file`.
Hydration `hydrateIpasSignatures(vm)` (`ipasPrinter.js`): fetch each distinct `signaturePath` once
via `signatureService.downloadSignature(path)` → `blobToDataUrl` → `box.signatureBase64`; on failure
the box keeps the name and its stamp gets ` · signature image unavailable`.
Sign-off rows store `signature_version` (copy of `employees.signature_path` at signing) and
`signature_declined` — see access-helpers.md.

## Money gating in a view model (prior art)

`buildIpasViewModel` reads `ipas.canReadBankDetails` and sets `section3.bank = null` when false,
**even if the caller handed over bank rows** (test "drops bank details even if a caller hands over
a row the person may not read"; assertions use `JSON.stringify(model)).not.toContain(...)`).
That is the precedent for "a participant's print carries no money keys".

## Prototype branch `prototype/printed-costing-matrix` (#229)

One file only: `src/lib/pdf/printed-costing-matrix.prototype.html` (660 lines). Read with
`git show prototype/printed-costing-matrix:src/lib/pdf/printed-costing-matrix.prototype.html`.
Commits: `636244d4 prototype(pms): three printed Costing Matrix layouts`,
`e99d275a ... refine contrast, alignment, and padding`. Self-contained HTML + inline JS sample data
(Emergency Response Vehicle, S07983, ABC ₱3,200,000, Final Offer ₱2,980,000, target ×1.47,
components 1.1 bundle Toyota ambulance acquire 2,160,500 ×1.47 complies, 1.2 Redleaf stretcher
acquire 78,000 odoo 71,400 ×1.35 deviates with note, cost-only C1 Delivery Charge 100,000 ×1.00,
19 inclusions one missing). Variant switch `?variant=A|B|C`.

Shared furniture (all variants):
- Tokens: `--paper #fff`, `--ink #0f1419`, `--ink-mid #272f3a`, `--ink-soft #3f4753`,
  `--ink-faint #545f6e`, `--rule #cbd5e1`, `--hair #e2e8f0`, `--wash #f8fafc`,
  `--accent #0d4f3c` ("T3CK green — used for the money spine only"), `--flag #b91c1c`,
  `--ok #15803d`. Fonts Geist / Geist Mono / Spectral.
- `.sheet { width: 297mm; min-height: 210mm; padding: 10mm 12mm 9mm; font-size: 8.6pt }`;
  `@media print { @page { size: A4 landscape; margin: 0; } .sheet { page-break-after: always; } }`.
- `rail(sub)`: mark + "T3CKGROUP / <entity> · purchasing" + right "Costing Matrix" (serif 15pt) and
  mono "S07983 · v4 · <sub>".
- `facts()`: Client, Project, ABC, Target markup ×1.47, Incharge ("408 sales · 114 purchasing").
- `sigs()`: 4-column grid — **Prepared by** (Sales incharge), **Costed by** (Purchasing incharge),
  **Evaluation approved** (Purchasing Manager · 1001), **Final Acquire & offer approved**
  (General Manager · 101). Each: `.k` label, `.plate` (printed italic serif name when no stored
  signature), `.who`, `.role`, `.stamp` (`Signature required` in flag red when awaiting, dashed plate).
- `summaryRows()`: Total offer, Less VAT 12%, Less tax 6%, Retention 1%, Collected amount,
  Operational expenses (final acquire), Marketing, OPEX, ITR "(offer less ₱250,000, at 8%)",
  **Revenue** (strong). Note: "Every figure on this sheet is the bid estimate. Landed Cost replaces
  nothing: it prints beside these once the purchases are made."
- `foot(page)`: ref · version · printed time | "Landed Cost provisional until purchasing marks costs
  complete" | "sheet 1 of 2 · money".
- Prototype maths (not authoritative): `vatEx = offer/1.12`, `tax = offer*0.06`,
  `retention = offer*0.01`, `collected = offer - tax - retention`, `itr = (offer-250000)*0.08`,
  `revenue = (offer - finalAcquireTotal) - itr`, `achievedLine = offer / faComponents`,
  `abcUse = offer / abc`.

**Variant A — "Ledger" (band header source):** one wide `table.ledger-table` with a two-row
`<thead>`: a `tr.band` owner-band row — `Client / Sales` (colspan 2), `Purchasing` (colspan 4),
`Automatic`, `Management`, `After purchase` — over the column row No., Specification, Brand &
sourcing, P.O./RFQ, Acquire, Odoo, Markup, Final acquire, Landed cost. CSS:
`thead tr.band th { font-size: 6.4pt; color: var(--ink-faint); letter-spacing: .1em; border-bottom: 0; text-transform: uppercase; }`.
Tender line row (`tr.line`, bold, spec first 3 lines + "+ N more specification lines, in full on
the appendix"), component rows, an inclusions row (`.incl-wrap`, 4-col grid, ✓ / ✗ in flag red,
"Included with 1.1 · checked at bid time · 18 of 19 covered"), cost-only rows ("Cost only — no
specification, no offer line"); Landed cost cells show `.chip.prov` "awaiting purchase".

**Variant B — "Tender-line blocks" (margin strip source):** `.block` grid `72mm 1fr 44mm`:
left `.ask` (wash background: "Tender line 1 · 1 unit · ABC ₱3,200,000", serif name, full spec
list), middle `.supply` table + inclusions, right **`.margin-strip`** with stacked `.k`/`.v` pairs:
**Final offer**, **Cost of this line**, **Markup achieved** "×1.33 <small>vs ×1.47</small>" (offer ÷ line's Final Acquire), **Against ABC**
"93.1%" with `.bar` (accent fill to %, flag-red 1.5px tick at 100%), **Landed cost** chip
"awaiting purchase". A second block for cost-only rows ("Charges outside tender lines … in no
single line's margin") with a "Cost-only total" strip.

**Variant C — "Money sheet + appendix" (the chosen base):**
- Sheet 1 ("management sheet"): rail, facts, then `.close` grid `1fr 82mm`:
  left `.mgmt` = table (No., Tender line "· N components, M inclusions", ABC, Acquire, Final
  acquire, Final offer, Achieved) with one `tr.line` per Tender Line and one row per cost-only row
  ("· cost only", ABC/offer "—", achieved column shows its factor); a `.verdict` prose box
  ("One deviation to accept or price out. Component 1.2 offers … the compliant model adds ₱9,400 and
  would take the achieved markup to ×N. One inclusion, the beacon lights, is still missing");
  then `sigs()`. Right: `spine()` (accent left border: big "Final offer", "Against ABC" % + bar,
  "Markup target"/"Achieved", "Final acquire"/"Revenue") + `summaryRows()`. Footer "sheet 1 of 2 · money".
- Sheet 2 ("specification appendix"): heading "Tender line 1 · <name>", one `.entry` per Component
  in two columns — "What the client asked for" (tender spec list) vs "1.1 · what we offer · Brand"
  (offer spec + "status · availability · source · PO") — then a `.verdict` (green border + "complies"
  chip, or flag border + "deviates" chip + note); then the inclusions grid "Inclusions checked
  against the ask · 18 of 19 covered". Footer "sheet 2 of 2 · specifications".
- #274 asks for variant C + B's margin strip + A's band header (owner bands on the appendix /
  grid header).
