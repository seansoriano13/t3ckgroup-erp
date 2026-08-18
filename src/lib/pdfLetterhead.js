import { PDFArray, PDFName, PDFRawStream, StandardFonts, rgb } from "pdf-lib";

/**
 * Swaps the company name printed in the header of an Odoo-rendered quotation
 * PDF for a store's own letterhead, entirely in the browser.
 *
 * Why this exists: the CDO and Tagbilaran storefronts sell under Odoo's one
 * "TG Enterprise" company record — Odoo has no separate company for them, and
 * creating one is a much bigger change than the cosmetic one being asked for.
 * So the printed header is patched client-side, after Odoo's render lands and
 * before the PDF is handed to the browser's download, keyed off which store
 * account requested it.
 *
 * How the patch works: Odoo's PDF (via wkhtmltopdf) draws the header string
 * with a `<hex> Tj` operator against an Identity-H/CID-subset font, so "TG
 * Enterprise" never appears as literal bytes in the file — it has to be
 * reassembled from the font's ToUnicode CMap. Once found, the matching
 * show-text operator is deleted from the content stream (not painted over —
 * deleting means the old name is gone from copy/paste and text search, not
 * just hidden under a white box) and the replacement is drawn back in a
 * standard font at the same position.
 *
 * Scoped to hex-string `Tj`, deliberately not `TJ` arrays or literal-string
 * `Tj`: every PDF writer this has actually met — Odoo/wkhtmltopdf for the
 * real file, pdf-lib itself for the redraw and for this module's own test
 * fixtures — always encodes shown text as a hex string. Handling forms that
 * have never been observed here would be untested weight; if a future
 * renderer batches the header differently, `patchPageText` simply finds no
 * match and returns 0, which the caller already treats as "could not apply
 * the letterhead" rather than a crash.
 */

const ODOO_LETTERHEAD_COMPANY_NAME = "TG Enterprise";

/**
 * Storefronts are provisioned as `store<city>opc@gmail.com` — "opc" for the
 * one-person-corporation each is registered as. That naming convention is
 * exactly the derivation rule below, so a new branch needs a new email
 * account, not a code change here.
 */
const STORE_LETTERHEAD_EMAIL_RE = /^store([a-z]+)opc@gmail\.com$/i;

/**
 * Resolves the letterhead a quotation should carry for the account
 * downloading it. Returns null for anything outside the `store*opc@gmail.com`
 * pattern — e.g. head-office accounts — meaning the PDF is left exactly as
 * Odoo rendered it.
 */
export function resolveStoreLetterhead(email) {
  const match = String(email || "")
    .trim()
    .toLowerCase()
    .match(STORE_LETTERHEAD_EMAIL_RE);
  return match ? `STORE ${match[1].toUpperCase()}` : null;
}

/**
 * Native, dependency-free deflate/inflate — supported by every browser this
 * app targets and by Node under Vitest. Built on `Response`, not `Blob`:
 * jsdom (the test environment) supplies its own `Blob` without a `.stream()`
 * method, where `Response` is left as Node's real implementation.
 */
async function inflate(bytes) {
  const stream = new Response(bytes).body.pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function deflate(bytes) {
  const stream = new Response(bytes).body.pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** 1:1 byte<->char round trip — never interpreted as UTF-8, so a PDF's binary content stream survives intact. */
function bytesToBinaryString(bytes) {
  let out = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return out;
}
function binaryStringToBytes(str) {
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i) & 0xff;
  return bytes;
}
function concatBytes(chunks) {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/**
 * Decodes a font's ToUnicode CMap into { "GID hex" -> character }. Handles
 * both bfrange forms PDF allows: `<lo> <hi> <baseUnicode>` (sequential) and
 * `<lo> <hi> [<u1> <u2> ...]` (explicit list) — Odoo's renderer uses the
 * second, and assuming only the first silently maps every glyph after the
 * range's first entry to the wrong character.
 */
async function parseToUnicode(ctx, fontDict) {
  const tuRef = fontDict.get(PDFName.of("ToUnicode"));
  if (!tuRef) return null;
  const tu = ctx.lookup(tuRef);
  let bytes = tu instanceof PDFRawStream ? tu.contents : tu.getContents();
  if (String(tu.dict.get(PDFName.of("Filter"))).includes("Flate")) bytes = await inflate(bytes);
  const s = bytesToBinaryString(bytes);
  const map = {};
  const key = (i) => i.toString(16).toUpperCase().padStart(4, "0");

  for (const blk of s.match(/beginbfchar([\s\S]*?)endbfchar/g) || []) {
    for (const [, g, u] of blk.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      map[g.toUpperCase().padStart(4, "0")] = String.fromCodePoint(parseInt(u.slice(0, 4), 16));
    }
  }

  const RANGE = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:\[([^\]]*)\]|<([0-9A-Fa-f]+)>)/g;
  for (const blk of s.match(/beginbfrange([\s\S]*?)endbfrange/g) || []) {
    for (const [, lo, hi, arr, base] of blk.matchAll(RANGE)) {
      const a = parseInt(lo, 16);
      const z = parseInt(hi, 16);
      if (arr !== undefined) {
        const units = [...arr.matchAll(/<([0-9A-Fa-f]+)>/g)].map((x) => x[1]);
        for (let i = a; i <= z && i - a < units.length; i++) {
          map[key(i)] = String.fromCodePoint(parseInt(units[i - a].slice(0, 4), 16));
        }
      } else {
        const b = parseInt(base.slice(0, 4), 16);
        for (let i = a; i <= z; i++) map[key(i)] = String.fromCodePoint(b + (i - a));
      }
    }
  }
  return map;
}

/**
 * Scans one page's content stream for every `<hex> Tj` operator, decoding
 * each through the active font's ToUnicode map (or, for a simple non-CID
 * font, treating each hex byte as its own character code directly). Returns
 * the decoded text plus, for every character, which operator produced it —
 * so a match can be traced back to exactly the operator(s) to delete.
 *
 * Granularity is per operator, not per character: a `Tj` showing several
 * characters at once is one deletable span. That is safe here because the
 * only thing ever searched for is the whole header string, never a fragment
 * that could share an operator with unrelated text.
 */
function scanShowTextTokens(src, cmaps) {
  const spans = []; // { start, end }
  const charSpan = [];
  let decoded = "";
  let currentFont = null;

  const TOKEN = /\/(\S+)\s+[\d.]+\s+Tf|<([0-9A-Fa-f]*)>\s*Tj/gd;
  let m;
  while ((m = TOKEN.exec(src))) {
    if (m[1] !== undefined) {
      currentFont = "/" + m[1];
      continue;
    }
    const digits = m[2];
    const spanIdx = spans.push({ start: m.index, end: m.index + m[0].length }) - 1;
    const map = cmaps[currentFont];
    const width = map ? 4 : 2; // CID (Identity-H) codes are 2 bytes; simple-font codes are 1 byte
    for (let i = 0; i + width <= digits.length; i += width) {
      const code = digits.slice(i, i + width).toUpperCase().padStart(4, "0");
      decoded += map ? map[code] ?? "�" : String.fromCharCode(parseInt(digits.slice(i, i + width), 16));
      charSpan.push(spanIdx);
    }
  }
  return { decoded, charSpan, spans };
}

/** Deletes every operator span covering an occurrence of `needle` in `decoded`. Deleting rather than blanking is what makes the old name gone from copy/paste and text search, not just hidden. */
function deleteOccurrences(src, needle, decoded, charSpan, spans) {
  const hit = new Set();
  let count = 0;
  for (let i = decoded.indexOf(needle); i !== -1; i = decoded.indexOf(needle, i + needle.length)) {
    count++;
    for (let k = i; k < i + needle.length; k++) hit.add(charSpan[k]);
  }
  if (!count) return { src, count: 0 };

  const cuts = [...hit].map((idx) => spans[idx]).sort((a, b) => b.start - a.start);
  for (const { start, end } of cuts) src = src.slice(0, start) + src.slice(end);
  return { src, count };
}

/** Removes every occurrence of `text` from one page's content stream. Returns how many occurrences were found. */
async function patchPageText(pdfDoc, page, text) {
  const ctx = pdfDoc.context;
  const node = page.node;

  const fontDict = node.Resources()?.lookup(PDFName.of("Font"));
  const cmaps = {};
  if (fontDict) {
    for (const [key] of fontDict.entries()) {
      const font = fontDict.lookup(key);
      const isCID = String(font.get(PDFName.of("Subtype"))) === "/Type0";
      cmaps[key.toString()] = isCID ? await parseToUnicode(ctx, font) : null;
    }
  }

  const contents = ctx.lookup(node.get(PDFName.of("Contents")));
  const parts = contents instanceof PDFArray ? contents.asArray().map((r) => ctx.lookup(r)) : [contents];
  const wasFlate = String(parts[0].dict.get(PDFName.of("Filter"))).includes("Flate");
  const raw = concatBytes(parts.map((s) => (s instanceof PDFRawStream ? s.contents : s.getContents())));
  const decodedBytes = wasFlate ? await inflate(raw) : raw;
  const src = bytesToBinaryString(decodedBytes);

  const { decoded, charSpan, spans } = scanShowTextTokens(src, cmaps);
  const { src: patched, count } = deleteOccurrences(src, text, decoded, charSpan, spans);
  if (!count) return 0;

  const outBytes = binaryStringToBytes(patched);
  const finalBytes = wasFlate ? await deflate(outBytes) : outBytes;
  const stream = ctx.stream(finalBytes, wasFlate ? { Filter: PDFName.of("FlateDecode") } : {});
  node.set(PDFName.of("Contents"), ctx.register(stream));

  return count;
}

/**
 * Deletes every occurrence of `from` from the given pages' content streams
 * and draws `to` back at a fixed position — the header's position in Odoo's
 * quotation report template, measured once and stable across orders since
 * every S0#### quotation uses the same layout. Only pages where `from` was
 * actually found get the replacement drawn, so passing brochure pages in by
 * mistake is a harmless no-op rather than a stray label.
 *
 * Returns the total number of occurrences removed, across all pages.
 */
export async function replaceLetterheadText(
  pdfDoc,
  pages,
  { from = ODOO_LETTERHEAD_COMPANY_NAME, to, x = 29.6, y = 799.6, size = 10.25, color = rgb(0, 0, 0) } = {},
) {
  if (!to) throw new Error('replaceLetterheadText requires "to".');

  let font = null;
  let replaced = 0;
  for (const page of pages) {
    const count = await patchPageText(pdfDoc, page, from);
    if (!count) continue;
    font ??= await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    page.drawText(to, { x, y, size, font, color });
    replaced += count;
  }
  return replaced;
}

export { ODOO_LETTERHEAD_COMPANY_NAME };
