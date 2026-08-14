import { PDFDocument } from "pdf-lib";
import { supabase } from "../lib/supabase";

/**
 * Assembles the customer-facing quotation PDF: the Odoo quotation first, then
 * every product brochure behind it.
 *
 * Odoo's own "PDF Quote" puts the brochures first and the merge order is
 * hardcoded Python we cannot change on Odoo Online, so the document is
 * rebuilt here instead. The bytes come through the odoo-quotation-file proxy
 * because Odoo sends no CORS headers; the merge itself runs in the browser,
 * where memory is plentiful (measured: ~3.5x the input size, and a 105 MB set
 * merges in under half a second).
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
 * Odoo renders the quotation live, and while brochures are still merged into
 * it that render is measured in minutes. The client's 20s default would abort
 * it — and then retry, starting a second render on top of the first.
 *
 * These are passed as an AbortSignal rather than left to the default: the
 * wrapper in lib/supabase.js treats a caller-supplied signal as "this caller
 * owns the deadline" and stands aside, retry included.
 */
const QUOTATION_TIMEOUT_MS = 180000;
const DOCUMENT_TIMEOUT_MS = 60000;

/**
 * Brochures are fetched a few at a time. The point is to overlap the waiting,
 * not to open forty connections to Odoo through the proxy at once — the byte
 * count and the invocation count are identical either way.
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

async function fetchDocumentBytes(doc, cache) {
  const key = cacheKeyFor(doc);

  if (cache) {
    const hit = await cache.match(key);
    if (hit) return new Uint8Array(await hit.arrayBuffer());
  }

  const bytes = await invokeForBytes(
    { kind: "document", documentId: doc.id },
    `Could not fetch "${doc.name}" from Odoo.`,
    DOCUMENT_TIMEOUT_MS,
  );

  if (cache) {
    try {
      await cache.put(key, new Response(bytes));
    } catch {
      // Quota exceeded — the document is already in hand, so carry on.
    }
  }

  return bytes;
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
   * `warnings` names documents that are genuinely absent from the result — a
   * brochure that will not parse is skipped rather than failing the whole
   * download, because one bad datasheet should not stop a salesperson sending
   * anything at all. `notices` is separate and means something milder: the
   * brochures are all present but stayed where Odoo put them, in front of the
   * quotation, because moving them could not be done safely.
   *
   * `onProgress({ step, current, total, label })` fires as each file lands.
   */
  async buildQuotationPdf(salesReference, { onProgress } = {}) {
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

    // Odoo bakes every 'inside' document into the front of the render below,
    // so their page geometry is what says how much of that render to drop. It
    // has to be in hand before the quotation is even fetched.
    const insideDocs = documents.filter((d) => d.attached_on === "inside");
    const measured = new Map();
    let trimBlockedBy = null;

    if (insideDocs.length) {
      report("brochures", 0, 0, `Checking ${insideDocs.length} merged brochure(s)…`);

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
        if (result.ok) measured.set(insideDocs[i].id, result.value);
        else if (!trimBlockedBy) trimBlockedBy = insideDocs[i].name;
      });
    }

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
