// Pure and runtime-agnostic: imported by the edge function (Deno) and by the
// frontend test runner. No Deno/Node/browser imports here.

export interface IncomeNote {
  marketplaceOrderId: string | null;
  marketplaceFee: number | null;
  orderIncome: number | null;
}

/**
 * Strip Odoo's note HTML down to plain text, preserving line breaks.
 * Block-level closes and <br> become newlines first so a `LABEL: value` line
 * stops at its real end (issue #172).
 */
export function toPlainText(raw: string): string {
  return raw
    .replace(/<img\b[^>]*>/gi, " ") // a pasted screenshot's base64 can be megabytes; drop it before the passes below copy it
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|pre|h[1-6]|blockquote)>/gi, "\n")
    .replace(/<[^>]*>?/gm, " ")
    .replace(/&amp;nbsp;|&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

/**
 * "₱1,234.50" / "PHP 12" -> number; anything else -> null (no partial parses).
 * Commas must be thousands separators, so "20,00" is not twenty thousand.
 */
function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/₱|php|:/gi, "").replace(/\s+/g, "");
  return /^(\d+|\d{1,3}(,\d{3})+)(\.\d{1,2})?$/.test(cleaned) ? Number(cleaned.replace(/,/g, "")) : null;
}

// Every label that can start a value. A value runs to the next label, so the
// older notes that put several labels on one line still split correctly.
const LABELS =
  /\b(ORDER\s+ID|ORDER\s+INCOME|OI|FEE|TOTAL\s+BUYER\s+AMOUNT|BUYER\s+PAYMENT|PROOF\s+OF\s+PAYMENT|DELIVERY\s+DETAILS|DATE\s+OF\s+PAYMENT|DATE|PAID|PENALTY|REMARKS|LOCATION|NAME)\b/gi;

const RECONCILE_TOLERANCE = 0.05;

/**
 * Read a Retail Order's Marketplace Order ID, Marketplace Fee and Order Income
 * from the text of its Income Note. Each is null when absent or unreadable.
 * Order Income is only what the note says; never Order Amount − Fee (ADR 0031).
 */
export function parseIncomeNote(note: string | null | undefined, orderAmount: number): IncomeNote {
  let marketplaceOrderId: string | null = null;
  let marketplaceFee: number | null = null;
  let orderIncome: number | null = null;
  let buyerAmount: number | null = null;

  for (const line of toPlainText(note ?? "").split("\n")) {
    const text = line.replace(/\s+/g, " ").trim();
    const found = [...text.matchAll(LABELS)];
    found.forEach((m, i) => {
      const label = m[1].toUpperCase().replace(/\s+/g, " ");
      const value = text.slice(m.index! + m[0].length, found[i + 1]?.index ?? text.length).trim();
      if (label === "ORDER ID") {
        // An id carries a digit; "ORDER ID: Bulacan" is a place typed in the wrong field.
        const token = value.replace(/^:/, "").trim().match(/^[^\s,]+/)?.[0];
        if (marketplaceOrderId === null && token && /\d/.test(token)) marketplaceOrderId = token;
      } else if (label === "ORDER INCOME" || label === "OI") {
        if (orderIncome === null) orderIncome = parseAmount(value);
      } else if (label === "FEE") {
        if (marketplaceFee === null) marketplaceFee = parseAmount(value);
      } else if (label === "TOTAL BUYER AMOUNT") {
        if (buyerAmount === null) buyerAmount = parseAmount(value);
      }
    });
  }

  if (
    orderIncome === null &&
    marketplaceFee !== null &&
    buyerAmount !== null &&
    Math.abs(marketplaceFee + buyerAmount - orderAmount) <= RECONCILE_TOLERANCE
  ) {
    orderIncome = buyerAmount;
  }

  return { marketplaceOrderId, marketplaceFee, orderIncome };
}
