// What an S0 save does with Odoo's answer (#816, spec #800, ADR 0050).
//
// Pure functions over the answer the sor-sales-reference edge function got from Odoo, so the rules
// are tested without Odoo or the database. The edge function passes the result to the
// service-role-only set_sales_reference; the browser never sends Odoo facts.

/** One Odoo order line, as the lookup reads it. */
export type OdooS0Line = {
  odoo_line_id?: number | null;
  odoo_product_id?: number | null;
  product_name?: string | null;
  unit?: string | null;
  quantity?: number | null;
  unit_price?: number | string | null;
};

/** What asking Odoo about an S0 came back with. */
export type S0Answer =
  | { kind: "found"; name: string; items: OdooS0Line[] }
  | { kind: "not_found" }
  | { kind: "unreachable" };

/** What the save step is told: the Odoo fact, the S0 to save, and the lines to pull (or none). */
export type S0Outcome = {
  odoo: "found" | "not_found" | "unreachable";
  salesReference: string;
  items: Record<string, unknown>[] | null;
};

const S0_PATTERN = /^S[0-9]+$/;

/** What was typed as an S0: trimmed, upper-cased, SO123 read as S123. Null when it is not an S0. */
export function normalizeS0(raw: string | null | undefined): string | null {
  let ref = (raw || "").trim().toUpperCase();
  if (/^SO[0-9]+$/.test(ref)) ref = "S" + ref.slice(2);
  return S0_PATTERN.test(ref) ? ref : null;
}

/** An Odoo order line as a Product List row: the shape sor_replace_items takes (same as modal/odooLines.js toRow). */
export function lineToRow(line: OdooS0Line): Record<string, unknown> {
  return {
    product_name: line.product_name || "",
    unit: line.unit || "",
    quantity: line.quantity ?? 1,
    unit_price: line.unit_price ?? "",
    odoo_product_id: line.odoo_product_id ?? null,
    odoo_line_id: line.odoo_line_id ?? null,
    removed_from_s0: false,
  };
}

/**
 * Maps Odoo's answer into what the save step is given. Found: Odoo's own order name is the S0
 * (the lookup may match loosely), and its lines come along, unless there are none (an empty
 * quotation never replaces a Product List). Not found and unreachable carry no lines.
 */
export function outcomeFromAnswer(typed: string, answer: S0Answer): S0Outcome {
  if (answer.kind === "found") {
    const name = (answer.name || "").trim().toUpperCase();
    const rows = (answer.items || []).filter((l) => (l.product_name || "").trim()).map(lineToRow);
    return {
      odoo: "found",
      salesReference: S0_PATTERN.test(name) ? name : typed,
      items: rows.length ? rows : null,
    };
  }
  return { odoo: answer.kind, salesReference: typed, items: null };
}
