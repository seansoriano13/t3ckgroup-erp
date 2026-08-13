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
 */

const CACHE_NAME = "odoo-brochures-v1";

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

async function invokeForBytes(body, fallbackMessage) {
  const { data, error } = await supabase.functions.invoke("odoo-quotation-file", { body });
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
   * Builds the assembled PDF. Resolves with `{ blob, filename, warnings }`;
   * a brochure that will not parse is skipped and named in `warnings` rather
   * than failing the whole download — one bad datasheet should not stop a
   * salesperson sending anything at all.
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

    report("quotation", 1, total, "Fetching the quotation…");
    const quotationBytes = await fetchQuotationBytes(salesReference);

    const target = await PDFDocument.create();
    await appendPdf(target, quotationBytes);

    const cache = await openCache();

    for (let i = 0; i < documents.length; i++) {
      const doc = documents[i];
      report("document", i + 2, total, doc.name);
      try {
        const bytes = await fetchDocumentBytes(doc, cache);
        await appendPdf(target, bytes);
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
      documentCount: documents.length - warnings.length,
      warnings,
    };
  },
};
