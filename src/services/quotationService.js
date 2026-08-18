import { PDFDocument } from "pdf-lib";
import { brochureUrl } from "../lib/brochureUrl";
import { replaceLetterheadText, resolveStoreLetterhead } from "../lib/pdfLetterhead";
import { supabase } from "../lib/supabase";

/**
 * Assembles the customer-facing quotation PDF: the Odoo quotation first, then
 * every product brochure behind it.
 *
 * Odoo's own "PDF Quote" puts the brochures first and the merge order is
 * hardcoded Python we cannot change on Odoo Online, so the document is
 * rebuilt here instead. The merge runs in the browser, where memory is
 * plentiful (measured: ~3.5x the input size, and a 105 MB set merges in under
 * half a second).
 *
 * Brochures come from Cloudinary, NOT from the odoo-quotation-file proxy.
 * Supabase is metered and a cold download of a large order was pushing ~125 MB
 * through it; the brochures are static per product, so they are mirrored once by
 * scripts/mirror-brochures.mjs and served from a CDN thereafter. Only the
 * quotation render still crosses Supabase, because Odoo sends no CORS headers
 * and there is no other route to it.
 *
 * A brochure missing from Cloudinary REFUSES the whole download rather than
 * falling back to the proxy. That is deliberate: a silent fallback would mean a
 * misconfigured mirror quietly bleeds egress and nobody notices until the bill.
 * Refusing is loud, names the documents, and is fixed by re-running the mirror.
 *
 * Documents Odoo has already merged ('inside' visibility) are trimmed off the
 * front of its render and re-appended at the back — see the guard on
 * `frontLooksLikeBrochures`, which refuses the trim rather than risk deleting
 * real quotation pages. Flipping those documents to 'quotation' visibility in
 * Odoo (odoo-document-admin) remains much the better fix: it stops Odoo
 * merging them at all, which removes a slow server-side render from the path
 * and halves what the proxy has to ship, because the brochures then travel
 * once instead of once inside the render and again on their own.
 */

const CACHE_NAME = "odoo-brochures-v1";

/**
 * Odoo renders the quotation live, and while brochures are still merged into it
 * that render is measured in minutes. Passed as an AbortSignal rather than left
 * to the default, because the wrapper in lib/supabase.js treats a
 * caller-supplied signal as "this caller owns the deadline" and stands aside —
 * its 20s default would abort the render and then retry, starting a second one
 * on top of the first.
 */
const QUOTATION_TIMEOUT_MS = 180000;

/** A CDN read, so generous only to survive a bad connection rather than a slow render. */
const DOCUMENT_TIMEOUT_MS = 60000;

/**
 * Brochures are fetched a few at a time — enough to overlap the waiting without
 * opening forty connections at once. Byte count is identical either way.
 */
const FETCH_CONCURRENCY = 5;

/** Past this, the download is worth announcing before it starts. */
const LARGE_DOWNLOAD_BYTES = 25 * 1024 * 1024;

/**
 * Brochures are static per product, so they are cached locally rather than
 * re-pulled through the proxy on every download. The Cache API keeps them in
 * the browser: no public URLs, no stale files accumulating in a bucket, and
 * nothing to clean up server-side. Keyed on the document's checksum so an
 * updated brochure invalidates itself.
 */
function cacheKeyFor(doc) {
  const version = doc.checksum || doc.write_date || "unversioned";
  return `https://brochure-cache.local/${doc.id}/${encodeURIComponent(version)}`;
}

async function openCache() {
  try {
    if (typeof caches === "undefined") return null;
    return await caches.open(CACHE_NAME);
  } catch {
    // Private browsing and non-secure contexts can both refuse. Losing the
    // cache is a slowdown, not a failure.
    return null;
  }
}

/** Pulls the readable message out of a non-2xx edge function response. */
async function messageFromError(error, fallback) {
  try {
    const body = await error?.context?.json();
    if (body?.message) return body.message;
  } catch {
    // Not a JSON body — fall through.
  }
  return error?.message || fallback;
}

async function invokeForBytes(body, fallbackMessage, timeoutMs) {
  const { data, error } = await supabase.functions.invoke("odoo-quotation-file", {
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (error) throw new Error(await messageFromError(error, fallbackMessage));
  if (!data) throw new Error(fallbackMessage);
  const buffer = await data.arrayBuffer();
  if (!buffer.byteLength) throw new Error(fallbackMessage);
  return new Uint8Array(buffer);
}

async function fetchQuotationBytes(salesReference) {
  // Never cached — the quotation carries pricing and Odoo renders it live.
  return invokeForBytes(
    { kind: "quotation", salesReference },
    "Could not fetch the quotation from Odoo.",
    QUOTATION_TIMEOUT_MS,
  );
}

/**
 * A brochure that has never been mirrored. Distinct from "downloaded but will
 * not parse": the second is one skippable datasheet, this one means the mirror
 * is out of date and the download must not proceed.
 */
class MissingBrochureError extends Error {
  constructor(doc) {
    super(`"${doc.name}" is not mirrored (document ${doc.id}).`);
    this.name = "MissingBrochureError";
    this.doc = doc;
  }
}

const CLOUD = {
  cloudName: import.meta.env.VITE_CLOUDINARY_CLOUD_NAME,
  folder: import.meta.env.VITE_CLOUDINARY_BROCHURE_FOLDER || "",
};

async function fetchDocumentBytes(doc, cache) {
  const key = cacheKeyFor(doc);

  if (cache) {
    const hit = await cache.match(key);
    if (hit) return new Uint8Array(await hit.arrayBuffer());
  }

  const response = await fetch(brochureUrl(doc, CLOUD), {
    signal: AbortSignal.timeout(DOCUMENT_TIMEOUT_MS),
  });
  if (response.status === 404) throw new MissingBrochureError(doc);
  if (!response.ok) {
    throw new Error(`Could not fetch "${doc.name}" (HTTP ${response.status}).`);
  }

  const buffer = await response.arrayBuffer();
  if (!buffer.byteLength) throw new MissingBrochureError(doc);
  const bytes = new Uint8Array(buffer);

  if (cache) {
    try {
      await cache.put(key, new Response(bytes));
    } catch {
      // Quota exceeded — the document is already in hand, so carry on.
    }
  }

  return bytes;
}

/**
 * Proves a brochure is mirrored without moving its bytes. A cached copy is
 * proof enough; otherwise a HEAD costs nothing and a miss is a clean 404.
 */
async function brochureExists(doc, cache) {
  if (cache && (await cache.match(cacheKeyFor(doc)))) return true;

  const response = await fetch(brochureUrl(doc, CLOUD), {
    method: "HEAD",
    signal: AbortSignal.timeout(DOCUMENT_TIMEOUT_MS),
  });
  if (response.status === 404) return false;
  if (!response.ok) {
    throw new Error(`Could not reach "${doc.name}" (HTTP ${response.status}).`);
  }
  return true;
}

/**
 * Names what is missing without pasting forty filenames into a toast, and says
 * what to do about it — the fix is always the same command.
 */
function unavailableMessage(entries) {
  const shown = entries.slice(0, 3).map(({ doc }) => `"${doc.name}" (id ${doc.id})`);
  const rest = entries.length - shown.length;
  const list = shown.join(", ") + (rest > 0 ? `, and ${rest} more` : "");
  return (
    `${entries.length} brochure(s) are not mirrored yet: ${list}. ` +
    `Run "npm run mirror:brochures" and try again.`
  );
}

/** Copies every page of `bytes` onto `target`. */
async function appendPdf(target, bytes) {
  // ignoreEncryption lets through the "protected but not password-locked"
  // PDFs that manufacturers routinely publish. A genuinely locked file still
  // throws, and the caller skips it.
  const source = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const pages = await target.copyPages(source, source.getPageIndices());
  pages.forEach((page) => target.addPage(page));
  return pages.length;
}

/**
 * Runs `worker` over every item with at most `limit` in flight, resolving to
 * one settled result per item in the original order. A rejection is returned
 * rather than thrown: one brochure that will not load is a warning, not a
 * failure of the whole download.
 */
async function settleWithLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;

  const drain = async () => {
    while (next < items.length) {
      const index = next++;
      try {
        results[index] = { ok: true, value: await worker(items[index], index) };
      } catch (error) {
        results[index] = { ok: false, error };
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, drain));
  return results;
}

/**
 * Fetches ahead by at most `limit` items while yielding them strictly in
 * order, so the caller can append and release each one as it arrives instead
 * of holding the whole set at once. On a forty-brochure order that difference
 * is what keeps the tab alive.
 */
async function* inOrderWithLimit(items, limit, worker) {
  const queue = [];
  let next = 0;

  const fill = () => {
    while (queue.length < limit && next < items.length) {
      const index = next++;
      queue.push(
        Promise.resolve()
          .then(() => worker(items[index], index))
          .then(
            (value) => ({ ok: true, value, index }),
            (error) => ({ ok: false, error, index }),
          ),
      );
    }
  };

  fill();
  while (queue.length) {
    const result = await queue.shift();
    fill();
    yield result;
  }
}

/** Page geometry is the only fingerprint pdf-lib can give us cheaply. */
const sizeKey = (page) => `${Math.round(page.getWidth())}x${Math.round(page.getHeight())}`;
const sizesOf = (pdf) => pdf.getPages().map(sizeKey);

/**
 * True when the first `expected.length` pages of Odoo's render plausibly are
 * the brochures it merged ahead of the quotation.
 *
 * This is a veto, not a proof. Sizes are compared as a multiset because Odoo's
 * merge order and the manifest's product-line ordering need not agree. Where
 * the brochures are a different paper size from the quotation — the usual case
 * for manufacturer datasheets — a mismatch is solid evidence that the front of
 * the render is not what we think it is, and trimming would delete real
 * quotation pages. Where every page is the same size the check cannot tell the
 * two apart, and the page-count arithmetic is the best evidence available.
 * pdf-lib cannot read text, so there is no cheaper stronger fingerprint.
 *
 * Requiring strictly more render pages than brochure pages doubles as the
 * arithmetic safety net: there has to be a quotation left behind the trim.
 */
function frontLooksLikeBrochures(renderSizes, expected) {
  if (!expected.length || renderSizes.length <= expected.length) return false;
  const front = renderSizes.slice(0, expected.length).sort();
  const want = [...expected].sort();
  return front.every((size, i) => size === want[i]);
}

const megabytes = (bytes) => `${(bytes / (1024 * 1024)).toFixed(0)} MB`;

export const quotationService = {
  /**
   * Lists the order and the brochures that would go into its assembled PDF.
   * Follows the same never-throw-on-a-normal-miss contract as odooService.
   */
  async fetchManifest(salesReference) {
    const { data, error } = await supabase.functions.invoke("odoo-quotation-manifest", {
      body: { salesReference },
    });
    if (error) throw new Error(await messageFromError(error, "Could not read the quotation."));
    return data;
  },

  /**
   * Builds the assembled PDF. Resolves with
   * `{ blob, filename, order, documentCount, warnings, notices }`.
   *
   * Three distinct outcomes, deliberately not collapsed into one:
   *
   * - **Throws** when a brochure is not mirrored to Cloudinary at all. The
   *   mirror is stale and the fix is to re-run it; handing over a quotation
   *   silently missing datasheets would be worse than refusing. This is checked
   *   before the quotation render is fetched, so a refusal costs nothing.
   * - **`warnings`** names documents that were fetched but could not be parsed
   *   and so are absent from the result. One bad datasheet should not stop a
   *   salesperson sending anything at all.
   * - **`notices`** is milder still: every brochure is present, but they stayed
   *   where Odoo put them — in front of the quotation — because moving them
   *   could not be done safely.
   *
   * `onProgress({ step, current, total, label })` fires as each file lands.
   *
   * `requestedByEmail` drives the letterhead swap: a `store<city>opc@gmail.com`
   * account gets "STORE <CITY>" patched over Odoo's "TG Enterprise" header (see
   * lib/pdfLetterhead.js — those storefronts sell under Odoo's one company
   * record and get no separate one there). Any other email, or none, leaves
   * the header exactly as Odoo rendered it.
   */
  async buildQuotationPdf(salesReference, { onProgress, requestedByEmail } = {}) {
    const report = (step, current, total, label) =>
      onProgress?.({ step, current, total, label });

    report("manifest", 0, 0, "Reading the quotation…");
    const manifest = await this.fetchManifest(salesReference);
    if (!manifest?.success) {
      throw new Error(manifest?.message || "Could not read the quotation.");
    }

    const documents = manifest.documents || [];
    const total = documents.length + 1;
    const warnings = [];
    const notices = [];
    const cache = await openCache();

    // The manifest already carries each file's size, so a heavy download can
    // be announced before a single byte moves rather than discovered when it
    // appears to stall.
    const declaredBytes = documents.reduce((sum, d) => sum + (Number(d.file_size) || 0), 0);
    if (declaredBytes > LARGE_DOWNLOAD_BYTES) {
      report(
        "manifest",
        0,
        0,
        `Preparing ${documents.length} brochures (${megabytes(declaredBytes)})…`,
      );
    }

    // Every brochure is proved present before the quotation is fetched. Odoo's
    // render of a large order takes minutes and tens of megabytes through the
    // proxy, and spending that on a download that is going to refuse anyway is
    // exactly the cost this whole change exists to avoid.
    const insideDocs = documents.filter((d) => d.attached_on === "inside");
    const otherDocs = documents.filter((d) => d.attached_on !== "inside");
    const measured = new Map();
    const unavailable = [];
    let trimBlockedBy = null;

    if (documents.length) {
      report("brochures", 0, 0, `Checking ${documents.length} brochure(s)…`);
    }

    // Odoo bakes every 'inside' document into the front of the render, so their
    // page geometry is what says how much of it to drop. Those have to be
    // fetched in full rather than merely confirmed.
    if (insideDocs.length) {
      const loaded = await settleWithLimit(insideDocs, FETCH_CONCURRENCY, async (doc) => {
        const bytes = await fetchDocumentBytes(doc, cache);
        const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
        // The parsed document is deliberately not kept. Holding forty of them
        // alongside the merged render is what exhausts the tab; the bytes are
        // comparatively cheap and re-parsing at append time trades CPU for
        // memory, which is the right way round at this size.
        return { bytes, sizes: sizesOf(pdf) };
      });

      loaded.forEach((result, i) => {
        const doc = insideDocs[i];
        if (result.ok) measured.set(doc.id, result.value);
        else if (result.error instanceof MissingBrochureError) unavailable.push({ doc });
        // Present but unreadable is a different thing entirely: Odoo's copy is
        // still in the render, so the download proceeds without the rearrange.
        else if (!trimBlockedBy) trimBlockedBy = doc.name;
      });
    }

    // The rest only need to be proved present for now — they are streamed in
    // and released one at a time during assembly.
    if (otherDocs.length) {
      const checks = await settleWithLimit(otherDocs, FETCH_CONCURRENCY, (doc) =>
        brochureExists(doc, cache),
      );
      checks.forEach((result, i) => {
        if (!result.ok || !result.value) unavailable.push({ doc: otherDocs[i] });
      });
    }

    if (unavailable.length) throw new Error(unavailableMessage(unavailable));

    report("quotation", 1, total, "Fetching the quotation…");
    const quotationBytes = await fetchQuotationBytes(salesReference);

    const target = await PDFDocument.create();
    const rendered = await PDFDocument.load(quotationBytes, { ignoreEncryption: true });
    const expected = insideDocs.flatMap((d) => measured.get(d.id)?.sizes || []);

    let trimming = false;
    if (insideDocs.length) {
      if (trimBlockedBy) {
        notices.push(
          `The brochures stay in front of the quotation: "${trimBlockedBy}" could not be read, ` +
            `so there was no safe way to tell how much of Odoo's render to move.`,
        );
      } else if (!frontLooksLikeBrochures(sizesOf(rendered), expected)) {
        notices.push(
          `The brochures stay in front of the quotation: Odoo's render did not begin with the ` +
            `${expected.length} brochure page(s) expected, and trimming it anyway risked ` +
            `dropping quotation pages.`,
        );
      } else {
        trimming = true;
      }
    }

    const keep = trimming
      ? rendered.getPageIndices().slice(expected.length)
      : rendered.getPageIndices();
    const quotationPages = await target.copyPages(rendered, keep);
    quotationPages.forEach((page) => target.addPage(page));

    const storeLetterhead = resolveStoreLetterhead(requestedByEmail);
    if (storeLetterhead) {
      const patched = await replaceLetterheadText(target, quotationPages, { to: storeLetterhead });
      // Not a throw: Odoo's report template could change, or this could be a
      // format that never carried the header at all. Either way the download
      // still succeeds — just with the company's own name instead of the
      // store's, which is what would have happened before this feature.
      if (!patched) {
        notices.push(
          `Could not apply the "${storeLetterhead}" letterhead — the quotation still shows TG Enterprise.`,
        );
      }
    }

    // Without the trim, Odoo's copy of each 'inside' brochure is still at the
    // front of the render — appending it again is what produced
    // brochures → quotation → brochures in the first place.
    const toAppend = trimming
      ? documents
      : documents.filter((d) => d.attached_on !== "inside");

    let appended = 0;
    let done = 1;

    const fetchOne = (doc) => measured.get(doc.id)?.bytes ?? fetchDocumentBytes(doc, cache);

    for await (const result of inOrderWithLimit(toAppend, FETCH_CONCURRENCY, fetchOne)) {
      const doc = toAppend[result.index];
      done += 1;
      report("document", done, total, doc.name);

      if (!result.ok) {
        warnings.push(`${doc.name}: ${result.error.message}`);
        continue;
      }

      try {
        await appendPdf(target, result.value);
        appended += 1;
      } catch (err) {
        warnings.push(`${doc.name}: ${err.message}`);
      }
    }

    report("saving", total, total, "Assembling…");
    const merged = await target.save();

    return {
      blob: new Blob([merged], { type: "application/pdf" }),
      filename: `Quotation ${manifest.order?.name || salesReference}.pdf`,
      order: manifest.order,
      // Counted as they land, not derived from warnings.
      documentCount: appended,
      warnings,
      notices,
    };
  },
};
