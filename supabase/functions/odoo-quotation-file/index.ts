// Streams the rendered quotation PDF back to the browser as binary.
//
// This exists because Odoo sends no CORS headers on /my/orders, so the browser
// cannot fetch it directly. The merge still happens in the browser (see
// quotationService); only the bytes pass through here.
//
// It used to serve product brochures too, via kind:"document". That branch is
// deliberately gone: Supabase egress is metered, brochures are static per
// product, and they are now mirrored to Cloudinary once by
// scripts/mirror-brochures.mjs and served from there. Leaving the branch in
// place would have meant one careless refactor could quietly route a gigabyte
// back through a paid proxy, so the guarantee is structural rather than a
// matter of discipline. Do not restore it.
//
// One kind:
//   kind: "quotation" — the portal route (/my/orders/{id}?report_type=pdf),
//                       authenticated by the order's access_token. Odoo
//                       prepends every 'inside' product document to this
//                       render and NO entry point avoids that — the merge is a
//                       model-level override, not a controller one.
//                       quotationService trims those pages back off client
//                       side, but setting the documents to 'quotation'
//                       visibility is still much better: it keeps Odoo from
//                       merging (and re-rendering) the whole brochure set on
//                       every download, which is both the slow part and the
//                       expensive part. See odoo-document-admin.
//
// Deploy with the default JWT verification ON — this hands out customer-facing
// documents and pricing.

import {
  authenticate,
  corsHeaders,
  ensureAccessToken,
  findOrder,
  isConfigured,
  jsonResponse,
  NO_TOKEN_MESSAGE,
  normalizeReference,
  ODOO_URL,
  ORDER_TOKEN_FIELDS,
} from "../_shared/odoo.ts";

// Deliberately octet-stream, not application/pdf: supabase-js `invoke` picks
// its decoder from the Content-Type and only treats octet-stream as binary —
// anything else falls through to `response.text()`, which mangles the bytes.
function pdfResponse(bytes, filename) {
  return new Response(bytes, {
    headers: {
      ...corsHeaders,
      "Content-Type": "application/octet-stream",
      "Content-Length": String(bytes.byteLength),
      "X-Document-Filename": encodeURIComponent(filename),
    },
  });
}

/**
 * Fetches the quotation PDF via the Odoo customer portal route — the only way
 * to get quotation bytes out of Odoo Online with an API key.
 *
 * There is no RPC alternative. `ir.actions.report` exposes no public render
 * method in 17.0 (only retrieve_attachment, get_wkhtmltopdf_state,
 * get_paperformat, associated_view, create_action, unlink_action, barcode,
 * get_available_barcode_masks, report_action), and `_render_qweb_pdf` is
 * private, which execute_kw refuses. The report HTTP route is auth='user' and
 * API keys cannot open a web session, so the portal token route is it.
 *
 * IMPORTANT: this render merges every `attached_on = 'inside'` product
 * document in BEFORE the quotation pages, and switching entry points does not
 * avoid that — sale_pdf_quote_builder overrides
 * `_render_qweb_pdf_prepare_streams` on the ir.actions.report MODEL, so all
 * render paths go through it. The only lever on the Odoo side is the data:
 * documents set to 'quotation' instead of 'inside' are not merged. See
 * odoo-document-admin.
 *
 * Two consequences worth knowing before touching this. The render is slow in
 * proportion to what got merged — an order with forty brochures takes Odoo
 * minutes, well past any default client timeout — and every merged byte is
 * then shipped to the browser here and shipped *again* when quotationService
 * fetches the same brochures individually to reorder them. Flipping the
 * documents removes both costs at once.
 */
async function fetchQuotation(uid, ref) {
  const order = await findOrder(uid, ref, ORDER_TOKEN_FIELDS);
  if (!order) {
    return { error: `No Odoo quotation found matching "${ref}".`, found: false };
  }

  const token = await ensureAccessToken(uid, order);
  if (!token) return { error: `${order.name} ${NO_TOKEN_MESSAGE}`, found: true };

  const base = (ODOO_URL || "").replace(/\/+$/, "");
  const url =
    `${base}/my/orders/${order.id}?access_token=${token}&report_type=pdf&download=true`;

  const res = await fetch(url);
  if (!res.ok) {
    return { error: `Odoo returned ${res.status} rendering ${order.name}.`, found: true };
  }

  const bytes = new Uint8Array(await res.arrayBuffer());
  // A portal error page comes back as HTML with a 200, so check the magic
  // bytes rather than trusting the status.
  if (String.fromCharCode(...bytes.slice(0, 4)) !== "%PDF") {
    return {
      error: `Odoo did not return a PDF for ${order.name} — the share token may have been revoked.`,
      found: true,
    };
  }

  return { bytes, filename: `Quotation ${order.name}.pdf` };
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

  let body;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ success: false, message: "Invalid request body." });
  }

  const { kind, salesReference } = body || {};

  // Answered explicitly rather than ignored, so an old cached app bundle still
  // asking for brochures fails loudly instead of silently producing a quotation
  // with none of them.
  if (kind === "document") {
    return jsonResponse(
      {
        success: false,
        message:
          "Brochures are served from Cloudinary, not from this function. " +
          "Reload the page to pick up the current app.",
      },
      410,
    );
  }

  try {
    const uid = await authenticate();

    const ref = normalizeReference(salesReference);
    if (!ref) {
      return jsonResponse({
        success: false,
        message: 'Enter a valid Sales Reference first — "S" followed by digits, e.g. S01237.',
      });
    }

    const result = await fetchQuotation(uid, ref);
    if (result.error) {
      return jsonResponse({ success: false, found: result.found, message: result.error }, 404);
    }
    return pdfResponse(result.bytes, result.filename);
  } catch (err) {
    console.error("odoo-quotation-file error:", err);
    return jsonResponse({
      success: false,
      message: err instanceof Error ? err.message : "Could not fetch the document.",
    });
  }
});
