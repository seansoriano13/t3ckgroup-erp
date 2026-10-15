import { getFormType } from './formTypeRegistry';
import { pairIntoSheets } from './layout';
import { signatureService } from '../../services/signatureService';
import { sigBlock } from './sigBlock';
import { MARK } from './brandMark';
import QRCode from 'qrcode';

/** One half-sheet form. Exported so the live preview can render a single form outside the paired-sheet layout if it ever needs to. */
export function formHTML(d) {
  return '<div class="form">'
    + '<header class="rail"><span class="mark">' + MARK + '</span>'
    + '<span class="org"><b>T3CKGROUP</b>Human resources department</span>'
    + '<span class="sp"></span>'
    + '<span class="id"><span class="n m">' + d.recordNo + '</span><span class="r m" style="display:block">' + d.formLabel + '</span></span>'
    + '</header>'
    + '<div class="head">'
    + '<div class="l"><div class="kind">' + d.kind + '</div><div class="who">' + d.name + '</div><div class="meta">' + d.meta + '</div>'
    + '<div class="company"><span class="k">Name of Company</span> ' + (d.company ? '<b>' + d.company + '</b>' : '<span class="companyblank"></span>') + '</div></div>'
    + '<div class="r"><div class="k">' + d.bigK + '</div>'
    + '<div class="big">' + d.bigN + '<em>' + d.bigU + '</em></div>'
    + '<div class="ledger">' + (d.ledger || (d.requestedHours ? 'Requested <span class="strike">' + d.requestedHours + '</span> · credited ' + d.bigN + ' hrs' : '')) + '</div></div>'
    + '</div>'
    + '<div class="cols">'
    + '<div class="cL">'
    + '<div class="grid">' + d.fields.map(function (f) {
      return '<div class="f"><div class="k">' + f.k + '</div><div class="v ' + (f.v.match(/<span/) ? '' : 'm') + '">' + f.v + '</div>' + (f.x ? '<div class="x">' + f.x + '</div>' : '') + '</div>';
    }).join('') + '</div>'
    + '<div class="rem"><div class="k">' + d.remK + '</div><p>' + d.rem + '</p></div>'
    + '</div>'
    + '<div class="cR">'
    + '<div class="blk"><div class="k">Outcome</div><div class="v"><span class="dot"></span>' + d.outcome + '</div></div>'
    + '<div class="blk"><div class="k">HRD validation</div><div class="rows">'
    + d.hrd.map(function (h) { return '<div class="row"><span class="a">' + h[0] + '</span><span class="b2 m">' + h[1] + '</span></div>'; }).join('')
    + '</div></div>'
    + '</div></div>'
    + '<div class="band">'
    + '<div class="sigs n' + d.sigs.length + '">' + d.sigs.map(function (s) { return sigBlock(s); }).join('') + '</div>'
    + '<div class="verify"><img class="qr" src="' + d.qrDataUrl + '" alt="QR Code" />'
    + '<div><div class="u m">' + d.qrText + '</div>'
    + '<div class="h">Scan for this record’s live status. Anyone may verify it; the reason and attachments open only for HR and the employee.</div></div></div>'
    + '</div>'
    + '<div class="note">' + d.note + '</div>'
    + '</div>';
}

/**
 * Renders an ordered list of hydrated view models into the paired-sheet
 * markup that both the live Document Center preview and the final
 * print/export output share — pairing comes from `pairIntoSheets`, so the
 * two surfaces can never disagree about which forms land on which sheet.
 */
export function buildSheetsHtml(mappedData) {
  return pairIntoSheets(mappedData).map((sheet) => {
    const bottomHtml = sheet.bottom
      ? '<div class="land b">' + formHTML(sheet.bottom) + '</div>'
      : '<div class="land b"><div class="blank">Blank ' + sheet.top.formLabel + '</div></div>';
    return '<div class="paper">'
      + '<div class="land a">' + formHTML(sheet.top) + '</div>'
      + bottomHtml
      + '<div class="cutline"></div>'
      + '</div>';
  }).join('');
}

/** The full printable HTML document — same document the browser prints and the PDF export converts. No client-side script: pairing and rendering are already resolved. */
export function buildPrintableDocument(mappedData) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>TG-11, TG-12 &amp; TG-13</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400;500;600&family=Geist:wght@400;500;600&family=Spectral:ital,wght@0,400;0,500;0,600;1,400&display=swap">
<style>
  :root {
    --page: #FFFFFF; --ink: #37352F; --ink-2: rgba(55, 53, 47, .70); --ink-3: rgba(55, 53, 47, .46);
    --line: rgba(55, 53, 47, .10); --line-2: rgba(55, 53, 47, .17); --tint: #F7F6F3;
    --serif: "Spectral", ui-serif, Georgia, "Times New Roman", serif;
    --sans: "Geist", ui-sans-serif, system-ui, "Segoe UI", Helvetica, Arial, sans-serif;
    --mono: "Geist Mono", ui-monospace, "SFMono-Regular", Consolas, monospace;
  }
  * { box-sizing: border-box; }
  body { background: var(--page); color: var(--ink); margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  @page { size: letter portrait; margin: 0; }

  .paper { background: #FFFFFF; position: relative; width: 816px; height: 1056px; overflow: hidden; margin: 0 auto; }
  .land { position: absolute; left: 0; width: 816px; height: 528px; }
  .land.a { top: 0; } .land.b { top: 528px; }

  .cutline { position: absolute; left: 0; right: 0; top: 528px; border-top: 1px dashed #C6C1B8; }

  .form {
    --f-ink: #221F1A; --f-2: #4A463F; --f-3: #6E6A61;
    --f-rule: #C6C1B8; --f-hair: #E3E0D9; --f-well: #F2F0EA;
    width: 100%; height: 100%; padding: 28px 40px 20px;
    color: var(--f-ink); font-family: var(--sans); font-size: 12px; line-height: 1.4;
    display: flex; flex-direction: column;
  }
  .m { font-family: var(--mono); font-variant-numeric: tabular-nums; }
  .k { font-size: 7.5px; line-height: 1.3; font-weight: 500; letter-spacing: .155em; text-transform: uppercase; color: var(--f-3); }

  .rail { display: flex; align-items: center; gap: 12px; padding-bottom: 8px; border-bottom: 1px solid var(--f-rule); }
  .mark { width: 27px; height: 23px; flex: 0 0 27px; color: var(--f-ink); }
  .mark svg { display: block; width: 100%; height: 100%; }
  .rail .org { font-size: 7.5px; letter-spacing: .2em; text-transform: uppercase; color: var(--f-3); line-height: 1.55; font-weight: 500; }
  .rail .org b { display: block; font-size: 9.5px; letter-spacing: .155em; color: var(--f-2); font-weight: 600; }
  .rail .sp { flex: 1; }
  .rail .id { text-align: right; line-height: 1.45; }
  .rail .id .n { font-size: 13px; font-weight: 600; letter-spacing: .03em; }
  .rail .id .r { font-size: 9px; color: var(--f-3); letter-spacing: .05em; }

  .head { display: flex; align-items: flex-end; gap: 28px; padding: 15px 0 14px; border-bottom: 1px solid var(--f-rule); }
  .head .l { flex: 1 1 auto; min-width: 0; }
  .head .kind { font-size: 10.5px; line-height: 1.3; font-weight: 600; letter-spacing: .19em; text-transform: uppercase; color: var(--f-ink); }
  .head .who { font-family: var(--serif); font-size: 25px; font-weight: 500; letter-spacing: -.017em; line-height: 1.12; margin-top: 9px; }
  .head .meta { font-size: 10.5px; line-height: 1.3; color: var(--f-2); margin-top: 5px; letter-spacing: .002em; }
  .head .company { font-size: 9.5px; line-height: 1.3; color: var(--f-3); margin-top: 5px; }
  .head .company .k { display: inline; margin-right: 5px; }
  .head .company b { font-family: var(--mono); color: var(--f-ink); font-weight: 600; }
  .companyblank { display: inline-block; width: 130px; height: 1em; vertical-align: -3px; border-bottom: 1px solid var(--f-rule); }
  .head .r { flex: 0 0 auto; text-align: right; }
  .head .big { font-family: var(--mono); font-variant-numeric: tabular-nums; font-size: 31px; font-weight: 500; letter-spacing: -.035em; line-height: 1; margin-top: 8px; }
  .head .big em { font-style: normal; font-size: 12px; font-weight: 400; color: var(--f-2); margin-left: 6px; letter-spacing: 0; }
  .head .ledger { font-family: var(--mono); font-variant-numeric: tabular-nums; font-size: 9.5px; line-height: 1.3; color: var(--f-3); margin-top: 7px; letter-spacing: .01em; }
  .strike { text-decoration: line-through; text-decoration-thickness: 1px; text-underline-offset: 2px; }

  .cols { display: flex; gap: 24px; padding-top: 15px; flex: 1; min-height: 0; }
  .cL { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; }
  .cR { flex: 0 0 214px; padding-left: 24px; border-left: 1px solid var(--f-hair); display: flex; flex-direction: column; gap: 16px; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 13px 20px; }
  .f .v { font-size: 12.5px; line-height: 1.3; font-weight: 500; margin-top: 4px; letter-spacing: -.004em; }
  .f .x { font-size: 9.5px; line-height: 1.35; color: var(--f-3); margin-top: 2px; }
  .rem { margin-top: auto; padding-top: 13px; }
  .rem p { margin: 7px 0 0; font-family: var(--serif); font-style: italic; font-size: 13px; line-height: 1.55; color: var(--f-2); max-width: 46ch; }

  .blk .v { font-size: 12px; line-height: 1.3; font-weight: 600; margin-top: 5px; display: flex; align-items: center; gap: 7px; letter-spacing: -.004em; }
  .dot { width: 5px; height: 5px; border-radius: 50%; background: var(--f-ink); flex: 0 0 5px; }
  .rows { margin-top: 8px; display: grid; gap: 7px; }
  .row { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; font-size: 10px; line-height: 1.3; }
  .row .a { color: var(--f-3); white-space: nowrap; }
  .row .b2 { font-weight: 500; text-align: right; }

  .band { margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--f-rule); display: flex; gap: 26px; align-items: flex-start; }
  .sigs { flex: 1; display: grid; gap: 22px; }
  .sigs.n2 { grid-template-columns: 1fr 1fr; }
  .sigs.n3 { grid-template-columns: repeat(3, 1fr); }
  .sig .plate { height: 30px; margin-top: 6px; border-bottom: 1px solid var(--f-rule); display: flex; align-items: flex-end; justify-content: center; padding-bottom: 2px; }
  .sig.awaiting .plate { background: var(--f-well); }
  .sig .who { margin-top: 6px; font-size: 10.5px; line-height: 1.3; font-weight: 600; letter-spacing: -.008em; }
  .sig .role { font-size: 7.5px; line-height: 1.3; letter-spacing: .08em; text-transform: uppercase; color: var(--f-3); margin-top: 3px; }
  .sig .stamp, .sig .pending { font-family: var(--mono); font-size: 7px; line-height: 1.3; margin-top: 4px; letter-spacing: .02em; }
  .sig .stamp { color: var(--f-2); }
  .sig .pending { color: var(--f-3); letter-spacing: .12em; text-transform: uppercase; }
  .sig .plate img { max-height: 24px; max-width: 100%; object-fit: contain; }
  .sig .plate .printed-name { font-family: var(--serif); font-size: 16px; font-weight: 500; font-style: italic; margin-bottom: 2px; color: var(--f-ink); }

  .verify { flex: 0 0 188px; display: flex; gap: 11px; }
  .qr { width: 52px; height: 52px; flex: 0 0 52px; }
  .verify .u { font-family: var(--mono); font-size: 7.5px; line-height: 1.5; color: var(--f-2); word-break: break-all; }
  .verify .h { font-size: 7px; line-height: 1.45; color: var(--f-3); margin-top: 5px; }
  .note { margin-top: 11px; padding-top: 8px; border-top: 1px solid var(--f-hair); font-size: 7.5px; line-height: 1.35; color: var(--f-3); letter-spacing: .03em; }

  .blank { position: absolute; inset: 0; display: grid; place-content: center; gap: 8px; text-align: center; font-family: var(--mono); font-size: 11px; letter-spacing: .2em; text-transform: uppercase; color: #A8A399; }
</style>
</head>
<body>
  <div id="pages">${buildSheetsHtml(mappedData)}</div>
</body>
</html>`;
}

/**
 * Maps raw records to print-ready view models and hydrates them with QR
 * codes and any stored signature images — the async, I/O-bound step shared
 * by the live preview (which needs it to render) and the final print/export
 * (which needs the same hydrated data, never a second fetch of it).
 */
export async function hydrateRecordsForPrint(records) {
  const mappedData = records.map(r => getFormType(r.type).buildViewModel(r));

  for (const d of mappedData) {
    const origin = window.location.hostname === 'localhost' ? 'http://localhost:5173' : 'https://t3ckgroup-erp.online';
    const verifyUrl = `${origin}/verify/${d.verificationToken}`;
    d.qrDataUrl = await QRCode.toDataURL(verifyUrl, { margin: 0, scale: 4, color: { dark: '#000000', light: '#FFFFFF' } });
    d.qrText = `${origin.replace(/^https?:\/\//, '')}/verify/${d.verificationToken}`;

    for (const s of d.sigs) {
      if (s.signaturePath) {
        try {
          const blob = await signatureService.downloadSignature(s.signaturePath);
          if (blob) {
            s.signatureBase64 = await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result);
              reader.onerror = reject;
              reader.readAsDataURL(blob);
            });
          }
        } catch (e) {
          console.warn("Failed to load signature for", s.who, e);
        }
      }
    }
  }

  return mappedData;
}

/**
 * Opens the browser's native print dialog against an already-composed
 * document — no network call, no paid conversion API. This is the Document
 * Center's only print action; the browser's own "Save as PDF" destination
 * covers the case where HR wants a file rather than paper.
 */
export function printComposedHtml(html) {
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    throw new Error('Popup blocked! Please allow popups to print.');
  }
  return printIntoWindow(printWindow, html);
}

/**
 * Writes an already-composed document into a window the caller opened and
 * prints it. Split from `printComposedHtml` for a print that has to fetch first
 * (the IPAS refreshes from Odoo): the caller opens the window synchronously in
 * the click, where a popup blocker allows it, then writes into it when the
 * document is ready.
 */
export function printIntoWindow(printWindow, html) {
  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();

  // Wait briefly for fonts to load from Google Fonts, then print.
  return new Promise((resolve) => {
    setTimeout(() => {
      printWindow.print();
      resolve();
    }, 750);
  });
}

/**
 * Opens the blank window a form will print into, with a "Preparing…" note. Call
 * it synchronously in the click so popup blockers allow it. Null when refused.
 */
export function openPrintWindow(label) {
  const printWindow = window.open('', '_blank');
  if (!printWindow) return null;
  printWindow.document.open();
  printWindow.document.write(
    `<!DOCTYPE html><title>${label}</title><body style="font-family:system-ui,sans-serif;color:#334155;padding:32px">Preparing the ${label} for printing…</body>`,
  );
  printWindow.document.close();
  return printWindow;
}
