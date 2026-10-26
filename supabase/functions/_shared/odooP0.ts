// Reads Odoo purchase orders (P0s) with their lines, in the shape
// ./p0Suggestions.ts ranks. One search for the orders, one for all their lines.

import { executeKw } from "./odoo.ts";
import type { OdooP0 } from "./p0Suggestions.ts";

const ORDER_FIELDS = ["id", "name", "state", "partner_id", "date_order", "date_planned", "origin"];
const LINE_FIELDS = ["order_id", "product_id", "name", "product_qty", "qty_received"];

export type OdooP0Row = OdooP0 & { id: number; supplier: string | null };

export async function readP0s(uid: number, domain: unknown[], limit = 200): Promise<OdooP0Row[]> {
  const orders = await executeKw(uid, "purchase.order", "search_read", [domain, ORDER_FIELDS], {
    order: "date_order desc, id desc",
    limit,
  });
  if (!orders.length) return [];

  const lines = await executeKw(uid, "purchase.order.line", "search_read", [
    [["order_id", "in", orders.map((o: Record<string, unknown>) => o.id)]],
    LINE_FIELDS,
  ]);

  return orders.map((o: Record<string, unknown>) => ({
    id: o.id as number,
    name: String(o.name),
    state: String(o.state),
    origin: o.origin ? String(o.origin) : null,
    date_order: o.date_order ? String(o.date_order) : null,
    date_planned: o.date_planned ? String(o.date_planned).slice(0, 10) : null,
    supplier: Array.isArray(o.partner_id) ? String(o.partner_id[1]) : null,
    lines: lines
      .filter((l: Record<string, unknown>) => Array.isArray(l.order_id) && l.order_id[0] === o.id)
      .map((l: Record<string, unknown>) => ({
        product_id: Array.isArray(l.product_id) ? (l.product_id[0] as number) : null,
        product_name: Array.isArray(l.product_id) ? String(l.product_id[1]) : String(l.name ?? ""),
        quantity: Number(l.product_qty) || 0,
        received: Number(l.qty_received) || 0,
      })),
  }));
}
