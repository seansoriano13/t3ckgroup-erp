// Streams one PDF back to the browser as binary — either the quotation itself
// or a single product brochure.
//
// This exists because Odoo sends no CORS headers on /my/orders or /web/content,
// so the browser cannot fetch either directly. The merge still happens in the
// browser (see quotationService); only the bytes pass through here.
//
// Two kinds:
//   kind: "quotation" — renders via ir.actions.report (RPC), which outputs
//                       only the quotation template pages with no product
//                       document merge. Previously this used the portal route
//                       (/my/orders/{id}?report_type=pdf), which Odoo's Python
//                       merge prepends all 'inside' brochures to — making the
//                       assembled PDF show: brochures → quotation → brochures.
//                       The ir.actions.report path avoids that entirely.
//                       Falls back to the portal route for Odoo 15 and below
//                       where render_document_pdf does not exist.
//   kind: "document"  — reads product.document.datas over RPC by id.
//
// Deploy with the default JWT verification ON — this hands out customer-facing
// documents and pricing.

import {
  authenticate,
  corsHeaders,
  ensureAccessToken,
  executeKw,
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

function base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Fallback: fetches the quotation PDF via the Odoo customer portal route.
 *
 * WARNING: Odoo's portal render merges all `attached_on = 'inside'` product
 * documents BEFORE the quotation pages (hardcoded Python on Odoo Online).
 * Use this only when `ir.actions.report.render_document_pdf` is unavailable
 * (Odoo 15 and below).
 */
async function fetchQuotationViaPortal(uid, order) {
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

/**
 * Fetches the quotation PDF via `ir.actions.report.render_document_pdf`
 * (Odoo 16+). This renders only the `sale.report_saleorder` template —
 * the product.document merge step that prepends 'inside' brochures is
 * bypassed entirely, because that step only runs in the portal controller.
 *
 * Falls back to `fetchQuotationViaPortal` when the RPC method is unavailable.
 */
async function fetchQuotation(uid, ref) {
  const order = await findOrder(uid, ref, ORDER_TOKEN_FIELDS);
  if (!order) {
    return { error: `No Odoo quotation found matching "${ref}".`, found: false };
  }

  let pdfB64;
  try {
    // render_document_pdf returns [pdf_bytes_b64, "application/pdf"] on
    // Odoo 16/17. On Odoo 15 and below the method does not exist and
    // execute_kw throws, so we fall through to the portal route.
    const result = await executeKw(
      uid,
      "ir.actions.report",
      "render_document_pdf",
      [["sale.report_saleorder"], [order.id]],
    );
    pdfB64 = Array.isArray(result) ? result[0] : result;
  } catch (rpcErr) {
    console.warn(
      "ir.actions.report.render_document_pdf unavailable, falling back to portal route:",
      rpcErr instanceof Error ? rpcErr.message : rpcErr,
    );
    return fetchQuotationViaPortal(uid, order);
  }

  if (!pdfB64) {
    return { error: `Odoo returned no PDF bytes for ${order.name}.`, found: true };
  }

  const bytes = base64ToBytes(pdfB64);
  if (String.fromCharCode(...bytes.slice(0, 4)) !== "%PDF") {
    return {
      error: `Odoo did not return a valid PDF for ${order.name}.`,
      found: true,
    };
  }

  return { bytes, filename: `Quotation ${order.name}.pdf` };
}

async function fetchDocument(uid, documentId) {
  const [doc] = await executeKw(
    uid,
    "product.document",
    "read",
    [[documentId], ["name", "datas", "mimetype"]],
  );

  if (!doc || !doc.datas) {
    return { error: `Document ${documentId} has no file in Odoo.` };
  }

  return { bytes: base64ToBytes(doc.datas), filename: doc.name || `document-${documentId}.pdf` };
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

  const { kind, salesReference, documentId } = body || {};

  try {
    const uid = await authenticate();

    if (kind === "document") {
      if (!Number.isInteger(documentId)) {
        return jsonResponse({ success: false, message: "A numeric documentId is required." });
      }
      const result = await fetchDocument(uid, documentId);
      if (result.error) return jsonResponse({ success: false, message: result.error }, 404);
      return pdfResponse(result.bytes, result.filename);
    }

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
