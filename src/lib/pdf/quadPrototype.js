import { buildPrintableDocument, formHTML } from './htmlPrinter';

/**
 * Prototype for #858 (spec #844, decision 14): the leave / overtime / offset
 * form reshaped to a 2x2 grid, four forms per letter page, with cut lines.
 * It reuses the live form markup and stylesheet and only adds override CSS, so
 * the current two-per-page print (buildPrintableDocument) is unchanged.
 * Preview only: open the Document Center with ?quad=1.
 */

// Each quarter is 408x528 px. The form is laid out at 544x704 (portrait) and scaled by 0.75.
const QUAD_CSS = `
  .paper.quad { display: grid; grid-template-columns: 408px 408px; grid-template-rows: 528px 528px; }
  .quad .cell { position: relative; width: 408px; height: 528px; overflow: hidden; }
  .quad .cell .scale { width: 544px; height: 704px; transform: scale(.75); transform-origin: 0 0; }
  .quad .form { padding: 18px 24px 14px; }
  .quad .head { flex-wrap: wrap; gap: 10px; padding: 10px 0; }
  .quad .head .who { font-size: 21px; }
  .quad .head .r { text-align: left; }
  .quad .cols { flex-direction: column; gap: 10px; padding-top: 10px; overflow: hidden; }
  .quad .cL { flex: 1 1 0; min-height: 0; }
  .quad .cR { flex: 0 0 auto; padding-left: 0; border-left: 0; border-top: 1px solid var(--f-hair); padding-top: 8px; gap: 10px; }
  .quad .grid { gap: 9px 14px; }
  .quad .rem { min-height: 0; flex: 1 1 auto; overflow: hidden; }
  .quad .rem p { max-width: none; }
  .quad .band { flex-direction: column; gap: 10px; margin-top: 10px; padding-top: 10px; }
  .quad .sigs { width: 100%; gap: 12px; }
  .quad .verify { flex: 0 0 auto; }
  .quad .blank { font-size: 11px; }
  .quad .vline { position: absolute; top: 0; bottom: 0; left: 408px; border-left: 1px dashed #C6C1B8; }
  .quad .hline { position: absolute; left: 0; right: 0; top: 528px; border-top: 1px dashed #C6C1B8; }
`;

// Long reasons shrink to fit their quarter instead of being cut off.
const FIT_SCRIPT = `
  function fit() {
    document.querySelectorAll('.quad .rem').forEach(function (box) {
      var p = box.querySelector('p'); if (!p) return;
      var size = 13;
      p.style.fontSize = size + 'px';
      while (size > 5 && box.scrollHeight > box.clientHeight + 1) { size -= 0.5; p.style.fontSize = size + 'px'; }
    });
  }
  window.addEventListener('load', function () { fit(); if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit); });
`;

export function buildQuadSheetsHtml(mappedData) {
  const pages = [];
  for (let i = 0; i < mappedData.length; i += 4) pages.push(mappedData.slice(i, i + 4));
  return pages.map((group) => {
    const cells = [0, 1, 2, 3].map((n) => {
      const d = group[n];
      return '<div class="cell">' + (d
        ? '<div class="scale">' + formHTML(d) + '</div>'
        : '<div class="blank">Blank</div>') + '</div>';
    }).join('');
    return '<div class="paper quad">' + cells + '<div class="vline"></div><div class="hline"></div></div>';
  }).join('');
}

export function buildQuadDocument(mappedData) {
  const base = buildPrintableDocument(mappedData);
  return base
    .replace(/<div id="pages">[\s\S]*<\/div>\s*<\/body>/, '<div id="pages">' + buildQuadSheetsHtml(mappedData) + '</div><script>' + FIT_SCRIPT + '</script></body>')
    .replace('</style>', QUAD_CSS + '</style>');
}
