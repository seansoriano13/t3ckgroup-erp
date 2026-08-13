// Lists what goes into an assembled quotation PDF: the order, plus every
// product brochure attached to the products on its lines, deduplicated and in
// the order those products first appear on the quotation.
//
// Returns metadata only — the bytes come one file at a time from
// odoo-quotation-file, so a 52 MB brochure set never has to fit in one JSON
// response.
//
// Brochures live on `product.document`, which _inherits ir.attachment, so the
// file itself hangs off the attachment's res_model/res_id — pointing at either
// the variant (product.product) or the template (product.template). Both are
// checked.
//
// `attached_on` values accepted here are BOTH 'inside' and 'quotation':
//   'inside'    — what Odoo merges into its own PDF Quote (today's setting)
//   'quotation' — customer-visible on the portal, NOT merged (after the flip)
// Accepting both means this works before and after that change, so the flip is
// purely about stopping Odoo's merge rather than a hard cutover.

import {
  authenticate,
  corsHeaders,
  executeKw,
  findOrder,
  isConfigured,
  jsonResponse,
  normalizeReference,
} from "../_shared/odoo.ts";

const MERGEABLE_VISIBILITY = ["inside", "quotation"];

const DOCUMENT_FIELDS = [
  "id",
  "name",
  "mimetype",
  "attached_on",
  "res_model",
  "res_id",
  "file_size",
  "checksum",
  "write_date",
];

async function fetchProductIds(uid, orderId) {
  const lines = await executeKw(
    uid,
    "sale.order.line",
    "search_read",
    [[["order_id", "=", orderId]], ["product_id", "display_type"]],
    { order: "sequence asc" },
  );

  // Section and note lines carry no product. Order is preserved and duplicates
  // dropped so a product listed twice contributes its brochure once.
  const seen = new Set();
  const productIds = [];
  for (const line of lines) {
    if (line.display_type) continue;
    const id = line.product_id && line.product_id[0];
    if (!id || seen.has(id)) continue;
    seen.add(id);
    productIds.push(id);
  }
  return productIds;
}

async function fetchDocuments(uid, productIds) {
  if (!productIds.length) return [];

  const variants = await executeKw(
    uid,
    "product.product",
    "read",
    [productIds, ["product_tmpl_id"]],
  );

  const templateIds = [];
  const templateOf = new Map();
  for (const v of variants) {
    const tmplId = v.product_tmpl_id && v.product_tmpl_id[0];
    if (!tmplId) continue;
    templateIds.push(tmplId);
    templateOf.set(v.id, tmplId);
  }

  const documents = await executeKw(
    uid,
    "product.document",
    "search_read",
    [
      [
        ["attached_on", "in", MERGEABLE_VISIBILITY],
        "|",
        "&",
        ["res_model", "=", "product.product"],
        ["res_id", "in", productIds],
        "&",
        ["res_model", "=", "product.template"],
        ["res_id", "in", templateIds],
      ],
      DOCUMENT_FIELDS,
    ],
    { order: "name asc" },
  );

  // Rank each document by where its product first appears on the quotation, so
  // the brochure pack follows the order the customer reads.
  const rankOfProduct = new Map(productIds.map((id, i) => [id, i]));
  const rankOfTemplate = new Map();
  for (const [productId, tmplId] of templateOf) {
    const rank = rankOfProduct.get(productId);
    if (rank !== undefined && !rankOfTemplate.has(tmplId)) {
      rankOfTemplate.set(tmplId, rank);
    }
  }

  const ranked = documents.map((doc) => ({
    ...doc,
    rank:
      doc.res_model === "product.product"
        ? rankOfProduct.get(doc.res_id) ?? Number.MAX_SAFE_INTEGER
        : rankOfTemplate.get(doc.res_id) ?? Number.MAX_SAFE_INTEGER,
  }));

  ranked.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));

  // Odoo can hold the same document against both a variant and its template;
  // the merged PDF should show it once.
  const seenDocs = new Set();
  const unique = [];
  for (const { rank: _rank, ...doc } of ranked) {
    if (seenDocs.has(doc.id)) continue;
    seenDocs.add(doc.id);
    unique.push(doc);
  }
  return unique;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (!isConfigured()) {
    return jsonResponse({
      success: false,
      message: "Odoo integration is not configured on the server.",
    });
  }

  let salesReference;
  try {
    ({ salesReference } = await req.json());
  } catch {
    return jsonResponse({ success: false, message: "Invalid request body." });
  }

  const ref = normalizeReference(salesReference);
  if (!ref) {
    return jsonResponse({
      success: false,
      message: 'Enter a valid Sales Reference first — "S" followed by digits, e.g. S01237.',
    });
  }

  try {
    const uid = await authenticate();
    const order = await findOrder(uid, ref);

    if (!order) {
      return jsonResponse({
        success: false,
        found: false,
        message: `No Odoo quotation found matching "${ref}".`,
      });
    }

    const productIds = await fetchProductIds(uid, order.id);
    const documents = await fetchDocuments(uid, productIds);

    return jsonResponse({
      success: true,
      found: true,
      order: { id: order.id, name: order.name, state: order.state },
      products: productIds.length,
      documents,
    });
  } catch (err) {
    console.error("odoo-quotation-manifest error:", err);
    return jsonResponse({
      success: false,
      message: err instanceof Error ? err.message : "Could not list the quotation documents.",
    });
  }
});
