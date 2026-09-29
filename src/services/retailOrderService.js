import { supabase } from "../lib/supabase";

// PostgREST caps a response at 1000 rows by default, and a report that quietly
// stops at 1000 orders is a wrong total.
const PAGE_SIZE = 1000;

const COLUMNS =
  "id, odoo_so_number, storefront, partner_name, buyer_name, odoo_salesperson_name, amount, ordered_at, odoo_state, is_excluded";

/**
 * Every order the Retail report can count: synced from Odoo into
 * `retail_orders`, minus the ones somebody dismissed in the old queue. The
 * confirmed-in-Odoo filter and the date range live in `utils/retailReport.js`,
 * so the totals are testable without a database.
 */
export async function getRetailOrders() {
  const orders = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("retail_orders")
      .select(COLUMNS)
      .eq("is_excluded", false)
      .order("ordered_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    orders.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return orders;
}
