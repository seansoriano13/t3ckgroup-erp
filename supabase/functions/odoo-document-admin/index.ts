// Inspects and flips `product.document.attached_on` in Odoo — the setting that
// decides whether a brochure gets merged into Odoo's own PDF Quote.
//
//   'inside'    — Odoo merges it into the quotation PDF, BEFORE the quotation
//                 pages. This is the ordering we cannot fix on Odoo Online.
//   'quotation' — customer-visible on the portal, NOT merged.
//
// Moving brochures from 'inside' to 'quotation' is step 2a of the plan: it
// stops Odoo double-adding them so the assembled PDF from quotationService is
// the only merged document, quotation-first.
//
// This exists because the setting is buried in Odoo's product form and is
// impractical to change by hand across a catalogue.
//
// SAFETY:
//   - `audit` is read-only.
//   - `setVisibility` requires an explicit list of document ids. There is no
//     "flip everything" mode, deliberately — a mass update to product config
//     should be something you opt into id by id.
//   - Every flip returns the previous value of each document, so a rollback is
//     exact rather than a guess. KEEP THAT RESPONSE.
//   - `setVisibility` additionally requires an `x-admin-token` header matching
//     the ODOO_ADMIN_TOKEN secret, and refuses outright when that secret is
//     unset. Platform JWT verification is satisfied by the anon key, which is
//     a fine gate for reading a quotation but not for rewriting product
//     configuration in the live ERP.
//
// Deploy with the default JWT verification ON, and set the secret first:
//   supabase secrets set ODOO_ADMIN_TOKEN=$(openssl rand -hex 24)

import {
  authenticate,
  corsHeaders,
  executeKw,
  findOrder,
  isConfigured,
  jsonResponse,
  normalizeReference,
} from "../_shared/odoo.ts";

const VALID_VISIBILITY = ["inside", "quotation", "sale_order", false];

const ADMIN_TOKEN = Deno.env.get("ODOO_ADMIN_TOKEN");

/** Fails closed: no secret configured means no writes, ever. */
function adminTokenRejection(req) {
  if (!ADMIN_TOKEN) {
    return "Writes are disabled — set the ODOO_ADMIN_TOKEN function secret first.";
  }
  if (req.headers.get("x-admin-token") !== ADMIN_TOKEN) {
    return "Missing or incorrect x-admin-token header.";
  }
  return null;
}

const DOC_FIELDS = ["id", "name", "attached_on", "res_model", "res_id", "file_size"];

/** Counts every product.document by its attached_on value. */
async function auditAll(uid) {
  const groups = await executeKw(
    uid,
    "product.document",
    "read_group",
    [[], ["id"], ["attached_on"]],
    { lazy: false },
  );

  return groups.map((g) => ({
    attached_on: g.attached_on || "(not set)",
    count: g.__count ?? g.attached_on_count ?? 0,
  }));
}

/** The documents attached to the products on one quotation. */
async function documentsForOrder(uid, ref) {
  const order = await findOrder(uid, ref);
  if (!order) return { error: `No Odoo quotation found matching "${ref}".` };

  const lines = await executeKw(
    uid,
    "sale.order.line",
    "search_read",
    [[["order_id", "=", order.id]], ["product_id", "display_type"]],
    { order: "sequence asc" },
  );

  const productIds = [
    ...new Set(
      lines.filter((l) => !l.display_type && l.product_id).map((l) => l.product_id[0]),
    ),
  ];
  if (!productIds.length) return { order, documents: [] };

  const variants = await executeKw(
    uid,
    "product.product",
    "read",
    [productIds, ["product_tmpl_id"]],
  );
  const templateIds = variants.map((v) => v.product_tmpl_id?.[0]).filter(Boolean);

  const documents = await executeKw(
    uid,
    "product.document",
    "search_read",
    [
      [
        "|",
        "&",
        ["res_model", "=", "product.product"],
        ["res_id", "in", productIds],
        "&",
        ["res_model", "=", "product.template"],
        ["res_id", "in", templateIds],
      ],
      DOC_FIELDS,
    ],
    { order: "name asc" },
  );

  return { order, documents };
}

/**
 * Sets attached_on on the named documents, returning what each one was before
 * so the change can be undone precisely.
 */
async function setVisibility(uid, documentIds, attachedOn) {
  const before = await executeKw(
    uid,
    "product.document",
    "read",
    [documentIds, ["id", "name", "attached_on"]],
  );

  const missing = documentIds.filter((id) => !before.some((d) => d.id === id));
  if (missing.length) {
    return { error: `No product.document with id(s): ${missing.join(", ")}.` };
  }

  await executeKw(uid, "product.document", "write", [
    documentIds,
    { attached_on: attachedOn },
  ]);

  const after = await executeKw(
    uid,
    "product.document",
    "read",
    [documentIds, ["id", "name", "attached_on"]],
  );

  return {
    // Feed this straight back into setVisibility to undo, one value per group.
    rollback: before.map((d) => ({ id: d.id, name: d.name, attached_on: d.attached_on })),
    result: after.map((d) => ({ id: d.id, name: d.name, attached_on: d.attached_on })),
  };
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

  const { action, salesReference, documentIds, attachedOn } = body || {};

  try {
    const uid = await authenticate();

    if (action === "audit") {
      const summary = await auditAll(uid);

      if (salesReference) {
        const ref = normalizeReference(salesReference);
        if (!ref) {
          return jsonResponse({ success: false, message: "Invalid Sales Reference." });
        }
        const scoped = await documentsForOrder(uid, ref);
        if (scoped.error) return jsonResponse({ success: false, message: scoped.error });
        return jsonResponse({ success: true, summary, ...scoped });
      }

      return jsonResponse({ success: true, summary });
    }

    if (action === "setVisibility") {
      const rejection = adminTokenRejection(req);
      if (rejection) return jsonResponse({ success: false, message: rejection }, 403);

      if (!Array.isArray(documentIds) || !documentIds.length) {
        return jsonResponse({
          success: false,
          message: "documentIds must be a non-empty array — there is no flip-everything mode.",
        });
      }
      if (!documentIds.every(Number.isInteger)) {
        return jsonResponse({ success: false, message: "documentIds must all be integers." });
      }
      if (!VALID_VISIBILITY.includes(attachedOn)) {
        return jsonResponse({
          success: false,
          message: `attachedOn must be one of: ${VALID_VISIBILITY.map(String).join(", ")}.`,
        });
      }

      const outcome = await setVisibility(uid, documentIds, attachedOn);
      if (outcome.error) return jsonResponse({ success: false, message: outcome.error });
      return jsonResponse({ success: true, ...outcome });
    }

    return jsonResponse({
      success: false,
      message: 'action must be "audit" or "setVisibility".',
    });
  } catch (err) {
    console.error("odoo-document-admin error:", err);
    return jsonResponse({
      success: false,
      message: err instanceof Error ? err.message : "Odoo request failed.",
    });
  }
});
