// Pure helpers for Odoo payment notes (issue #324). No Deno or network here, so
// the rules can be unit-tested from the app's own test suite.
//
// A payment note only ever ATTACHES proof to the SOR whose sales_reference is
// exactly the Odoo order number. It never changes a status or a Stage: deciding
// that a deal is Paid (and what that means on a Sales Flow) is a person's call.

/** Same shape as SALES_REFERENCE_PATTERN in _shared/odoo.ts: S followed by digits. */
const SALES_REFERENCE = /^S\d+$/;

export const PROOF_LOG_MARKER = "Proof of Payment imported";

export type ProofAttachment = { url: string; name: string; type: string };

/** A note that reports a payment: it carries both a MODE OF PAYMENT and an AMOUNT. */
export function isPaymentNote(plainText: string): boolean {
  const text = plainText.toUpperCase();
  return text.includes("MODE OF PAYMENT") && /AMOUNT:?\s*[\d,.]+/.test(text);
}

/**
 * The Odoo order number to match an SOR on, or null when it is not a plain
 * sales reference. Exact and validated, so a stray name or a blank can never
 * reach a query, and there is no fuzzy fallback.
 */
export function salesReferenceFrom(orderName: unknown): string | null {
  if (typeof orderName !== "string") return null;
  const name = orderName.trim();
  return SALES_REFERENCE.test(name) ? name : null;
}

/**
 * Screenshot <img> tags in the note's HTML, as attachments for the SOR log.
 * Odoo serves images at site-relative paths, so they are resolved against the
 * Odoo base URL. Anything that is not an http(s) address after that is dropped.
 */
export function extractProofImages(rawHtml: string, odooUrl: string): ProofAttachment[] {
  const base = (odooUrl || "").replace(/\/+$/, "");
  const attachments: ProofAttachment[] = [];
  const imgTag = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = imgTag.exec(rawHtml)) !== null) {
    let url = match[1];
    if (url.startsWith("/")) url = `${base}${url}`;
    if (!/^https?:\/\//i.test(url)) continue;
    attachments.push({ url, name: "Proof_of_Payment.png", type: "image/png" });
  }
  return attachments;
}

/**
 * The SOR to attach proof to, from the rows whose sales_reference equals the
 * order number. Deleted SORs do not count. Two live SORs on one reference is a
 * data problem a person must sort out, so neither gets the proof.
 */
export function pickExactSor(
  rows: { id: string; is_deleted?: boolean | null }[] | null | undefined,
): string | null {
  const live = (rows ?? []).filter((r) => !r.is_deleted);
  return live.length === 1 ? live[0].id : null;
}
