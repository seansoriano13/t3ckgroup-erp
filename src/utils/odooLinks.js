/**
 * Links into the company's Odoo. The app holds no Odoo address of its own (the
 * edge functions read it from the `ODOO_URL` secret), and the only link built so
 * far is the customer-portal quotation link. A salesperson or boss opening an
 * order in Odoo itself needs the backend form, so it is built here.
 */

/** The company's Odoo Online instance. */
export const ODOO_BASE_URL = "https://t3ckgrouponline.odoo.com"

/**
 * The backend form of one Odoo sale order, from its `sale.order` id — the
 * `retail_orders.odoo_so_id` that `odoo-sor-sync` copies from `sale.order.id`,
 * never the `S0xxxx` number, which Odoo cannot open by itself. This is the
 * `/web#id=…&model=…&view_type=form` form of Odoo 17.0, the instance's version
 * (`/web/webclient/version_info`); a later major version would need the
 * `/odoo/sale.order/<id>` form. Null while the sync has not given the order an
 * id (a row backfilled from an SOR), so the screen shows no link rather than a
 * wrong one.
 */
export function odooSaleOrderUrl(odooSoId) {
  const id = Number(odooSoId)
  if (!Number.isInteger(id) || id <= 0) return null
  return `${ODOO_BASE_URL}/web#id=${id}&model=sale.order&view_type=form`
}

/**
 * Odoo blank purchase order form (Odoo 17.0 form, no record id, so it opens a new
 * request for quotation). The app only links there; it never writes to Odoo.
 */
export const ODOO_NEW_PO_URL = `${ODOO_BASE_URL}/web#action=purchase.purchase_rfq&model=purchase.order&view_type=form`
