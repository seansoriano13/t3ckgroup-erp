/**
 * The paper set: the one stylesheet every A4 Purchasing print is drawn with (IPAS, Canvass,
 * S0 Evaluation, Packing List, Transmittal, TSR), so they share one page frame, one type scale
 * and one spacing scale. A form adds only what is its own; it never restates a size.
 *
 * The page frame, top to bottom:
 *   rail   mark, department, the record's number
 *   head   what the paper is, the name it is about, one big figure
 *   body   `.hdr` facts, then `.sec` sections under ruled heads
 *   band   the signatures, pinned to the foot of the page
 *   foot   number, print line, department
 *
 * Type scale (set once here, as variables):
 *   --t-micro  uppercase key labels and table heads     --t-fine   stamps, notes, the footer
 *   --t-table  table cells                              --t-body   running text
 *   --t-value  the value under a key label              --t-name / --t-figure  the head
 *
 * Spacing scale: --s-1 (tight, inside a group) to --s-4 (between sections). `.sheet.dense` is
 * the same scale one step tighter, for the IPAS, which carries six sections on one page.
 *
 * Margins: on paper the top and bottom margins belong to `@page`, so a form that runs onto a
 * second sheet keeps its margins there too. On screen (the previews) the sheet pads itself.
 */

export const PAGE_MARGIN = { top: 9, bottom: 8 };

/** The `@page` rule and the printed sheet height for one paper orientation. */
export function pageCss({ landscape = false } = {}) {
  const height = (landscape ? 210 : 297) - PAGE_MARGIN.top - PAGE_MARGIN.bottom - 1;
  return `
  @page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: ${PAGE_MARGIN.top}mm 0 ${PAGE_MARGIN.bottom}mm; }
  @media print { .sheet { padding-top: 0; padding-bottom: 0; min-height: ${height}mm; } }
`;
}

export const PAPER_CSS = `
  :root {
    --paper: #ffffff; --ink: #221F1A; --ink-mid: #4A463F; --ink-soft: #4A463F; --ink-faint: #6E6A61;
    --rule: #C6C1B8; --hair: #E3E0D9; --wash: #F2F0EA;
    --accent: #221F1A; --ok: #221F1A; --ok-bg: #ffffff; --ok-border: #221F1A;
    --flag: #b91c1c; --warn: #6E6A61; --warn-bg: #ffffff; --warn-border: #6E6A61;
    --sans: "Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    --mono: "Geist Mono", ui-monospace, "SFMono-Regular", Consolas, monospace;
    --serif: "Spectral", ui-serif, Georgia, "Times New Roman", serif;

    --t-micro: 6.4pt; --t-fine: 7pt; --t-table: 8pt; --t-body: 8.6pt; --t-value: 9pt;
    --t-name: 18pt; --t-figure: 22pt;
    --s-1: 1mm; --s-2: 2mm; --s-3: 3mm; --s-4: 5mm;
    --cell-y: 3px; --plate: 9mm;
    --page-x: 13mm;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #ffffff; color: var(--ink); font-family: var(--sans); -webkit-print-color-adjust: exact; print-color-adjust: exact; }

  .sheet {
    width: 210mm; min-height: 296mm; margin: 0 auto; padding: ${PAGE_MARGIN.top}mm var(--page-x) ${PAGE_MARGIN.bottom}mm;
    display: flex; flex-direction: column; gap: var(--s-4);
    font-size: var(--t-body); line-height: 1.38; color: var(--ink); background: var(--paper);
  }
  .sheet + .sheet { break-before: page; page-break-before: always; }
  .sheet.dense {
    --t-micro: 6pt; --t-fine: 6.6pt; --t-table: 7.4pt; --t-body: 7.8pt; --t-value: 8.2pt;
    --t-name: 15pt; --t-figure: 19pt;
    --s-1: .7mm; --s-2: 1.3mm; --s-3: 2mm; --s-4: 3.2mm;
    --cell-y: 1.7px; --plate: 7mm;
  }

  .m { font-family: var(--mono); font-variant-numeric: tabular-nums; }
  .k { font-size: var(--t-micro); line-height: 1.3; font-weight: 500; letter-spacing: .14em; text-transform: uppercase; color: var(--ink-faint); }

  /* Rail and head. The head hangs off the rail, so the two read as one masthead. */
  .rail { display: flex; align-items: center; gap: 12px; padding-bottom: var(--s-2); border-bottom: 1px solid var(--rule); }
  .rail .mark { width: 27px; height: 23px; flex: none; color: var(--ink); }
  .rail .mark svg { width: 100%; height: 100%; display: block; }
  .rail .org { font-size: var(--t-micro); letter-spacing: .2em; text-transform: uppercase; color: var(--ink-faint); line-height: 1.55; font-weight: 500; }
  .rail .org b { display: block; font-size: 7.4pt; letter-spacing: .155em; color: var(--ink-mid); font-weight: 600; }
  .rail .doc { margin-left: auto; text-align: right; line-height: 1.45; }
  .rail .doc .t { font-size: 10pt; font-weight: 600; letter-spacing: .03em; font-family: var(--mono); }
  .rail .doc .s { font-family: var(--mono); font-size: var(--t-fine); color: var(--ink-faint); }
  .copy-mark { display: inline-block; margin-left: 6px; padding: 0 5px; border: 1px solid var(--ink); border-radius: 2px; font-family: var(--sans); font-size: var(--t-micro); font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: var(--ink); }
  .tag-state { display: inline-block; padding: 0 5px; border: 1px solid var(--rule); border-radius: 2px; font-family: var(--sans); font-size: var(--t-micro); font-weight: 600; letter-spacing: .06em; text-transform: uppercase; }
  .tag-state.filed { border-color: var(--ink); color: var(--ink); }
  .tag-state.cancelled { color: var(--flag); border-color: var(--flag); }

  .head { display: flex; align-items: flex-end; gap: 28px; margin-top: calc(var(--s-2) - var(--s-4)); padding-bottom: var(--s-3); border-bottom: 1px solid var(--rule); }
  .head .l { flex: 1 1 auto; min-width: 0; }
  .head .kind { font-size: 7.8pt; font-weight: 600; letter-spacing: .19em; text-transform: uppercase; }
  .head .who { font-family: var(--serif); font-size: var(--t-name); font-weight: 500; letter-spacing: -.017em; line-height: 1.12; margin-top: var(--s-1); overflow-wrap: anywhere; }
  .head .meta { font-size: var(--t-body); color: var(--ink-mid); margin-top: var(--s-1); }
  .head .company { font-size: var(--t-fine); color: var(--ink-faint); margin-top: var(--s-1); }
  .head .company .k { display: inline; margin-right: 5px; }
  .head .company b { font-family: var(--mono); color: var(--ink); font-weight: 600; }
  .head .r { flex: 0 0 auto; text-align: right; }
  .head .big { font-family: var(--mono); font-variant-numeric: tabular-nums; font-size: var(--t-figure); font-weight: 500; letter-spacing: -.035em; line-height: 1; margin-top: var(--s-1); }
  .head .big em { font-style: normal; font-size: var(--t-value); font-weight: 400; color: var(--ink-mid); margin-left: 6px; letter-spacing: 0; }
  .head .big.na { font-size: 13pt; color: var(--ink-faint); letter-spacing: 0; }
  .head .ledger { font-family: var(--mono); font-size: var(--t-fine); color: var(--ink-faint); margin-top: var(--s-1); }
  .head .r .f { margin-top: var(--s-1); }
  .head .r .f:first-child { margin-top: 0; }

  /* Two-column body: the reading column and a narrow column of figures. */
  .cols { display: flex; gap: 24px; flex: 1; min-height: 0; }
  .cL { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: var(--s-4); }
  .cR { flex: 0 0 56mm; padding-left: 20px; border-left: 1px solid var(--hair); display: flex; flex-direction: column; gap: var(--s-4); }
  .blk .v { font-size: var(--t-value); font-weight: 600; margin-top: 4px; }
  .blk .rows { margin-top: 6px; display: grid; gap: 5px; }
  .blk .row { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; font-size: var(--t-table); line-height: 1.3; }
  .blk .row .a { color: var(--ink-faint); }
  .blk .row .b { font-family: var(--mono); font-weight: 500; text-align: right; }
  .blk .row .b.wait { color: var(--ink-faint); }

  /* Facts: a key label over its value. */
  .hdr { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--s-2) 20px; }
  .f .k { display: block; margin-bottom: 2px; }
  .f .v { font-size: var(--t-value); font-weight: 500; overflow-wrap: anywhere; }
  .f .v.mono { font-family: var(--mono); font-size: calc(var(--t-value) - .4pt); }
  .f .x { display: block; font-size: var(--t-fine); color: var(--ink-faint); font-weight: 400; }
  .fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(32mm, 1fr)); gap: var(--s-2) 16px; }
  .fields.n3 { grid-template-columns: repeat(3, 1fr); }
  .fields.n2 { grid-template-columns: repeat(2, 1fr); }

  /* Sections: a ruled head, then the body. */
  .sec { display: flex; flex-direction: column; gap: var(--s-2); }
  .sec > h3 { margin: 0; display: flex; justify-content: space-between; align-items: baseline; gap: 8px; font-size: var(--t-micro); letter-spacing: .14em; text-transform: uppercase; color: var(--ink); border-bottom: 1px solid var(--rule); padding: 0 0 var(--s-1); font-weight: 600; }
  .sec > h3 b { font-family: var(--mono); color: var(--ink-faint); font-weight: 400; letter-spacing: 0; font-size: var(--t-fine); text-transform: none; }
  .sec > .body { display: flex; flex-direction: column; gap: var(--s-2); }
  .cols2 { display: grid; grid-template-columns: 1fr 1fr; gap: 6mm; align-items: start; }

  /* Tables: hairline rows, no boxes. Figures sit right, in mono. */
  table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  th, td { text-align: left; vertical-align: top; padding: var(--cell-y) 6px var(--cell-y) 0; border-bottom: 1px solid var(--hair); font-size: var(--t-table); }
  thead th { font-size: var(--t-micro); letter-spacing: .12em; text-transform: uppercase; color: var(--ink-faint); font-weight: 500; border-bottom: 1px solid var(--rule); padding: 0 6px 3px 0; vertical-align: bottom; }
  th.num, td.num { text-align: right; font-family: var(--mono); white-space: nowrap; padding-right: 0; padding-left: 8px; }
  th.center, td.center { text-align: center; }
  table.pay { table-layout: fixed; }
  table.pay th.num, table.pay td.num { padding-right: 10px; padding-left: 4px; }
  table.pay th { white-space: normal; overflow-wrap: break-word; }
  table.pay td { overflow-wrap: anywhere; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  tfoot td { font-weight: 600; border-top: 1px solid var(--ink); border-bottom: 0; padding: 4px 6px 0 0; }
  tfoot td.num { padding-right: 0; }
  /* A form to be written on by hand keeps a full grid. */
  table.grid { table-layout: fixed; }
  table.grid th, table.grid td { border: 1px solid var(--rule); padding: 3px 5px; }
  table.grid thead th { border-bottom-color: var(--ink-faint); color: var(--ink-mid); font-weight: 600; letter-spacing: .06em; padding: 3px 5px; }

  .pre { white-space: pre-line; }
  .sub { color: var(--ink-mid); font-size: var(--t-fine); }
  .empty { color: var(--ink-faint); font-style: italic; }
  .lede { font-family: var(--serif); font-size: 10pt; line-height: 1.5; margin: 0; white-space: pre-wrap; }
  /* The line a list adds up to: box count, weight, how many failed. */
  .total-line { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; border-top: 1px solid var(--ink); padding-top: var(--s-1); font-size: var(--t-body); font-weight: 600; }
  .total-line.flagged { color: var(--flag); }

  .build td .basis { color: var(--ink-faint); font-size: var(--t-fine); }
  .build tfoot td { font-family: var(--mono); font-size: var(--t-value); }
  .build tfoot td:first-child { font-family: var(--sans); font-size: var(--t-table); }

  .chk { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 11px; height: 11px; border-radius: 2px; border: 1px solid var(--ink-faint); background: #ffffff; font-size: 7.6pt; line-height: 1; color: transparent; vertical-align: middle; }
  .chk.done { border-color: var(--ink); color: var(--ink); font-weight: 700; }
  .chk.part { border-color: var(--ink-faint); color: var(--ink-mid); font-weight: 700; }

  .stat { display: flex; flex-wrap: wrap; gap: 4px 14px; }
  .stat .s { display: inline-flex; gap: 5px; align-items: center; font-size: var(--t-table); break-inside: avoid; color: var(--ink-faint); }
  .stat .s.done { color: var(--ink); font-weight: 500; }
  .stat .s .d { font-family: var(--mono); color: var(--ink-faint); font-size: var(--t-fine); font-weight: 400; }
  .stat .s.current .t { text-decoration: underline; text-underline-offset: 2px; }
  .odoo { color: var(--ink); font-size: var(--t-fine); line-height: 1; }
  .legend { color: var(--ink-mid); font-family: var(--sans); font-weight: 500; letter-spacing: 0; }
  .group-k { font-size: var(--t-micro); letter-spacing: .14em; text-transform: uppercase; color: var(--ink-faint); font-weight: 500; margin-bottom: 3px; }

  .box { border-top: 1px solid var(--hair); padding: var(--s-2) 0 0; break-inside: avoid; }
  .prov { display: inline-block; margin-left: 6px; padding: 0 5px; border: 1px solid var(--ink); border-radius: 2px; font-family: var(--sans); font-size: 5.8pt; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; vertical-align: 2px; color: var(--ink); }
  .prov.final { background: var(--ink); color: #ffffff; }
  .prov.na { border-color: var(--rule); color: var(--ink-faint); }
  .flag { color: var(--flag); font-weight: 700; }

  /* Signatures: the band sits at the foot of the page, every plate the same height. */
  .band { margin-top: auto; padding-top: var(--s-3); border-top: 1px solid var(--rule); break-inside: avoid; }
  .sigs { display: grid; gap: var(--s-3) 20px; }
  .sigs.n1 { grid-template-columns: minmax(0, 1fr); max-width: 33%; }
  .sigs.n2 { grid-template-columns: repeat(2, 1fr); }
  .sigs.n3 { grid-template-columns: repeat(3, 1fr); }
  .sigs.n4 { grid-template-columns: repeat(4, 1fr); }
  .sigs.n5 { grid-template-columns: repeat(5, 1fr); gap: var(--s-3) 14px; }
  .sig { display: flex; flex-direction: column; min-width: 0; break-inside: avoid; }
  .sig .k { color: var(--ink-faint); }
  .sig .plate { height: var(--plate); overflow: hidden; margin-top: 3px; border-bottom: 1px solid var(--rule); display: flex; align-items: flex-end; justify-content: center; padding-bottom: 2px; }
  .sig.awaiting .plate { background: var(--wash); }
  .sig .plate img { max-height: calc(var(--plate) - 1mm); max-width: 100%; object-fit: contain; }
  .sig .printed-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; font-family: var(--serif); font-style: italic; font-size: 11pt; font-weight: 500; line-height: 1.2; }
  .sig .who { font-size: var(--t-table); font-weight: 600; margin-top: 3px; overflow-wrap: anywhere; }
  .sig .who:empty { display: none; }
  .sig .role { font-size: var(--t-micro); letter-spacing: .08em; text-transform: uppercase; color: var(--ink-faint); margin-top: 2px; }
  .sig .role:empty { display: none; }
  .sig .stamp, .sig .pending { font-family: var(--mono); font-size: var(--t-micro); margin-top: 2px; }
  .sig .stamp { color: var(--ink-mid); }
  .sig .pending { color: var(--ink-faint); letter-spacing: .12em; text-transform: uppercase; }
  .sig .callsign { font-family: var(--mono); font-size: var(--t-fine); color: var(--ink-mid); margin-top: 2px; }

  .foot { display: grid; grid-template-columns: 1fr 1.6fr 1fr; align-items: start; gap: 12px; border-top: 1px solid var(--hair); padding-top: 4px; font-size: var(--t-micro); color: var(--ink-faint); font-family: var(--mono); margin-top: auto; }
  .band + .foot { margin-top: 0; }
  .foot .mid { text-align: center; }
  .foot .r { text-align: right; }
  ${pageCss()}
`;
