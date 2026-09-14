# What Odoo 17 exposes on a purchase order for IPAS

Research for [#215](https://github.com/seansoriano13/t3ckgroup-erp/issues/215), under the map [#210](https://github.com/seansoriano13/t3ckgroup-erp/issues/210).

**Question.** Over the JSON-RPC `execute_kw` path in `supabase/functions/_shared/odoo.ts`, which Odoo 17.0 models and fields can fill in an IPAS or tick off its milestones? What does each value mean?

**Sources.** Read on 2026-09-14:
- the Odoo source at `github.com/odoo/odoo`, branch `17.0` (LGPL Community addons)
- the official Odoo 17.0 documentation, whose source is `github.com/odoo/documentation`, branch `17.0`

In the tables, *line* numbers point into the 17.0 files. The live instance (`17.0+e`) was not queried. What is installed, configured and readable there belongs to #216.

## Short answer

### What Odoo can supply

All of it is read-only, over the existing `execute_kw`.

| IPAS item | Odoo field | Note |
|---|---|---|
| Entity | `purchase.order.company_id` | Only if the four entities are separate Odoo companies (#216). |
| Currency | `purchase.order.currency_id` | Every PO amount is in this currency. |
| P.O # | `purchase.order.name` | Already read. |
| P.I # | `purchase.order.partner_ref` | Only if Purchasing agrees to type the proforma number there. Odoo means it as the vendor's own order or bid reference. |
| Item, qty, price, P.I/QT Amount | order lines; `amount_untaxed` / `amount_total` | Already read. New: `price_subtotal`, `taxes_id`. |
| Received Date | `purchase.order.effective_date` | Date of the **first** completed receipt, not the last. |
| CRM S.O. No. | `purchase.order.origin` | `odoo-po-rollup` already searches on it. |
| Analytic Dist. | `purchase.order.line.analytic_distribution` | JSON of analytic account ids to percentages. |
| Payment rows (date, amount) | `account.payment` reconciled to the PO's bills | Advance payments not yet reconciled to a bill have **no link** to the PO. |
| Check No. | `account.payment.check_number` | Only for checks printed from Odoo (`account_check_printing`). |
| Bank Name, Account Name, Account # | `res.partner.bank`, via the bill's or payment's `partner_bank_id` | |
| Payment Importation charges | `stock.landed.cost.lines` | Only when Finance books them as landed-cost products. Amounts are in company currency. |

### Milestones Odoo can tick

| IPAS milestone | Odoo condition |
|---|---|
| Purchase Order | `purchase.order.state` is `purchase` or `done`. |
| Received in Odoo | `purchase.order.receipt_status` = `full`. Also `partial` or `pending`, and `false` when the PO has no receipts. |
| Create Bill | `purchase.order.invoice_ids` holds a bill that isn't cancelled. **Draft bills count.** |
| LC Odoo Done | A `stock.landed.cost` with `state` = `done` whose `picking_ids` include one of the PO's `picking_ids`. |
| Bill posted and paid (not an IPAS milestone, but free) | `account.move.state` = `posted`; `payment_state` = `paid`, or `in_payment` (see [Caveats](#caveats)). |

### What Odoo cannot supply

- **Header:** Priority, Source (Import or Local) and Purpose. Odoo's `priority` is only Normal or Urgent.
- **Payments:** the DP / 2nd / … / Full Payment numbering, Charge Fee, and the Payment Scheme list. Odoo payment methods are journal settings, not that list.
- **Shipping:** Freight Service, and every Supplier Origin date (Shipped Out, Onboard, Arrived in PH, Arrived in Whs.).
- **Status (Buyer):** With P.O.P, Import Clearance, Delivered and Actual Checking.
- **IPAS Computation Status:** Encoding, Encoded, LC GS Done and Check by.
- **Forms:** the Documentation and Finance checklists, the transmittal record, item location, and every sign-off.
- **BIR 2307:** Odoo produces no filed 2307. `l10n_ph` exports an XLS of 2307 data through a UI wizard only (see [l10n_ph](#l10n_ph-and-bir-2307)).

### New relative to the existing reads

- **`odoo-po-verify`** reads `purchase.order`: `id`, `name`, `state`, `partner_id`, `date_order`, `date_planned`, `amount_total`. It reads `purchase.order.line`: `product_id`, `name`, `product_qty`, `product_uom`, `price_unit`, `date_planned`.
- **`odoo-po-rollup`** is on `staging`; this branch's base predates it. It reads `id`, `name`, `state`, `partner_id`, `date_order`, `amount_untaxed`, `amount_total`, and searches by `origin` and `name`.

Everything else below is new. Neither function touches `stock.picking`, `stock.landed.cost`, `account.move`, `account.payment` or `res.partner.bank`.

## How values come back over JSON-RPC

- **Many2one:** `[id, display_name]`, or `false`.
- **One2many and Many2many:** a list of ids.
- **Selection:** the key (for example `to invoice`), or `false`.
- **Date:** `"YYYY-MM-DD"`.
- **Datetime:** `"YYYY-MM-DD HH:MM:SS"` in UTC.
- **Json:** an object.
- **Monetary:** a number in the currency field named on that record.

Computed fields that aren't stored can be read but not used in a search domain. ORM reference: <https://www.odoo.com/documentation/17.0/developer/reference/backend/orm.html>.

## `purchase.order`

Sources:
- **purchase:** [`addons/purchase/models/purchase_order.py`](https://github.com/odoo/odoo/blob/17.0/addons/purchase/models/purchase_order.py)
- **purchase_stock:** [`addons/purchase_stock/models/purchase_order.py`](https://github.com/odoo/odoo/blob/17.0/addons/purchase_stock/models/purchase_order.py)

| Field | Type | Meaning or values | IPAS use | Source |
|---|---|---|---|---|
| `state` | Selection, stored, tracked | `draft` RFQ; `sent` RFQ Sent; `to approve` To Approve; `purchase` Purchase Order; `done` Locked; `cancel` Cancelled. Confirm sets `purchase`, or `to approve` when two-step approval applies and the user may not approve. Lock sets `done`; Unlock goes back to `purchase`. | Milestone **Purchase Order** = `purchase` or `done` | purchase, lines 98–105, 501–528, 960–969 |
| `company_id` | Many2one `res.company`, required | Company that owns the PO | **Entity** | purchase, line 143 |
| `currency_id` | Many2one `res.currency`, required, not tracked | PO currency; defaults to the company currency. The display name is the ISO code. | **Currency** | purchase, lines 96–97 |
| `currency_rate` | Float, stored | Ratio of PO currency to company currency | Converting a USD or EUR PO to PHP | purchase, line 145 |
| `origin` | Char, not tracked | "Source Document": the document that generated the PO, for example a sales order | **CRM S.O. No.** | purchase, lines 81–83 |
| `partner_ref` | Char, not tracked | "Vendor Reference": the vendor's sales order or bid reference, which usually appears on their delivery note. Name search covers it (`_rec_names_search`). | **P.I #**, only by convention | purchase, lines 22, 84–88 |
| `partner_id` | Many2one `res.partner`, tracked | Vendor | **Supplier** (already read) | purchase, line 92 |
| `payment_term_id` | Many2one `account.payment.term` | Agreed payment terms; carried onto the bill | Context for DP and FP expectations. It has no payment amounts or dates. | purchase, line 136 |
| `incoterm_id`, `incoterm_location` | Many2one `account.incoterms`, Char | Incoterm and its place | Context for an import IPAS. It is not a freight service. | purchase line 137; purchase_stock line 17 |
| `date_order`, `date_approve` | Datetime | "Order Deadline" and "Confirmation Date" | — | purchase, lines 89–91 |
| `date_planned` | Datetime, stored, editable | "Expected Arrival": the earliest line `date_planned`, as promised by the vendor | An ETA hint, not a shipping milestone | purchase, lines 116–118, 186–193 |
| `effective_date` | Datetime, stored | "Arrival": `date_done` of the **earliest** done receipt, so a partial receipt already sets it | **Received Date** | purchase_stock, lines 27–28, 46–50 |
| `receipt_status` | Selection, stored | `pending` Not Received; `partial` Partially Received; `full` Fully Received. `false` when there are no receipts or all are cancelled, as on a services-only PO. | Milestone **Received in Odoo** | purchase_stock, lines 30–34, 60–70 |
| `picking_ids` | Many2many `stock.picking`, stored | The receipts, and any returns, created from the PO's lines | Join key to landed costs | purchase_stock, lines 19, 36–39 |
| `invoice_ids`, `invoice_count` | Many2many `account.move`, stored | Every move with a line linked to one of the PO's lines: bills and credit notes, **in any state, cancelled included** | Milestone **Create Bill**; the route to payments | purchase, lines 71–76, 109–110 |
| `invoice_status` | Selection, stored | `no` Nothing to Bill; `to invoice` Waiting Bills; `invoiced` Fully Billed. `no` unless the PO is `purchase` or `done`. `invoiced` means every line's `qty_to_invoice` is 0 and at least one bill exists, and **draft bills count**. It says nothing about payment. | A secondary signal for **Create Bill** | purchase, lines 47–69, 111–115; [bill control doc](https://www.odoo.com/documentation/17.0/applications/inventory_and_mrp/purchase/manage_deals/control_bills.html) |
| `amount_untaxed`, `amount_tax`, `amount_total` | Monetary, stored, PO currency | Totals. `amount_tax` includes withholding taxes on the lines, which are negative (see l10n_ph). | **P.I/QT Amount** | purchase, lines 121–124 |
| `priority` | Selection | `0` Normal, `1` Urgent | Doesn't map to the IPAS three-level Priority | purchase, lines 79–80 |

**Tracking on the PO.** Only these fields carry `tracking=True`:
- `state`
- `partner_id`
- `user_id`
- `amount_untaxed`

Edits to `origin`, `partner_ref`, `currency_id`, `payment_term_id` or `date_planned` leave no chatter trail. Source: purchase, lines 92, 105, 121, 140–142.

## `purchase.order.line`

Sources:
- **purchase:** [`addons/purchase/models/purchase_order_line.py`](https://github.com/odoo/odoo/blob/17.0/addons/purchase/models/purchase_order_line.py)
- **purchase_stock:** [`addons/purchase_stock/models/purchase_order_line.py`](https://github.com/odoo/odoo/blob/17.0/addons/purchase_stock/models/purchase_order_line.py)

| Field | Type | Meaning or values | IPAS use | Source |
|---|---|---|---|---|
| `analytic_distribution` | Json, stored, editable (from `analytic.mixin`) | `{"<analytic account id>": <percent>}`. A key can join several account ids with commas, one per analytic plan. Defaults come from analytic distribution models matching product, product category, vendor, vendor tags and company. Read `account.analytic.account` for the names. | **Analytic Dist. (102)** | purchase lines 14, 265–275; [`analytic_mixin.py`](https://github.com/odoo/odoo/blob/17.0/addons/analytic/models/analytic_mixin.py) lines 13–16, 58–63 |
| `taxes_id` | Many2many `account.tax` | Purchase taxes on the line: VAT and any Philippine withholding tax | Separating VAT from expanded withholding tax (EWT). Read `account.tax` for `name`, `amount` and `l10n_ph_atc`. | purchase, lines 33–40 |
| `price_subtotal` | Monetary, stored, PO currency | Line amount after discount, before tax | Item amount | purchase, lines 50, 97–108 |
| `price_tax`, `price_total` | Float, Monetary, stored | Line tax, and line total with tax | — | purchase, lines 51–52 |
| `qty_received_method` | Selection, stored | `manual` for services; `stock_moves` for consumable and storable products once `purchase_stock` is installed | Whether `qty_received` comes from receipts or was typed | purchase lines 64–67, 174–179; purchase_stock lines 23–24, 33–37 |
| `qty_received` | Float, stored | `stock_moves`: sum of **done** incoming moves less returns to the vendor, in the line's unit. `manual`: the typed `qty_received_manual`. | Per-line check for **Received in Odoo** | purchase lines 68–69, 181–187; purchase_stock lines 50–75 |
| `qty_invoiced` | Float, stored | Quantity on linked bills minus quantity on credit notes, over every linked move not cancelled. **Draft bills count.** | Per-line check for **Create Bill** | purchase, lines 62, 143–153 |
| `qty_to_invoice` | Float, stored | Ordered − billed when the product's Control Policy is "On ordered quantities"; received − billed for "On received quantities", the default | Drives `invoice_status` | purchase lines 70, 155–162; [`purchase/models/product.py`](https://github.com/odoo/odoo/blob/17.0/addons/purchase/models/product.py) lines 15–19 |
| `invoice_lines` | One2many `account.move.line` | Bill lines linked to this PO line | Link to bills | purchase, line 59 |
| `move_ids` | One2many `stock.move` | Stock moves for this line | Link to receipts | purchase_stock, line 26 |
| `display_type` | Selection | `line_section` or `line_note` for layout rows; `false` for real lines. Filter the layout rows out. | — | purchase, lines 83–85 |

## `res.partner.bank`: the supplier's bank account

Sources:
- **Base model:** [`odoo/addons/base/models/res_bank.py`](https://github.com/odoo/odoo/blob/17.0/odoo/addons/base/models/res_bank.py)
- **`account` extension:** [`addons/account/models/res_partner_bank.py`](https://github.com/odoo/odoo/blob/17.0/addons/account/models/res_partner_bank.py)

| Field | Type | Meaning or values | IPAS use | Source |
|---|---|---|---|---|
| `acc_number` | Char, required, tracked | Account number as typed | **Account #** | base line 79; account line 39 |
| `sanitized_acc_number` | Char, stored | `acc_number` with non-word characters removed, uppercased. Searches on `acc_number` are rewritten to use it. | Match an account regardless of spaces or dashes | base lines 12–15, 80, 97–100, 139–152 |
| `acc_holder_name` | Char, stored, tracked | Holder name; defaults to the partner's name | **Account Name** | base line 81; account line 40 |
| `partner_id` | Many2one `res.partner`, required, tracked | Account holder: a company or a top-level contact | The supplier the account belongs to | base line 82; account line 41 |
| `bank_id`, `bank_name`, `bank_bic` | Many2one `res.bank`, related Char | The bank, its name and its BIC/SWIFT | **Bank Name** | base lines 23–33, 84–86; account line 37 |
| `allow_out_payment` | Boolean, tracked | "Send Money": the account is trusted for outgoing payments. Only `account.group_validate_bank_account` or admins may set it. Odoo's help text warns about phishing with fake account numbers. | Flag an unverified account on the IPAS | base line 83; account lines 43–48, 245–254 |
| `currency_id` | Many2one `res.currency`, tracked | Account currency, optional | — | base line 88; account line 49 |
| `active` | Boolean, tracked | `false` when archived | — | base line 77; account line 38 |
| *(constraint)* | SQL unique | `(sanitized_acc_number, partner_id)` must be unique | — | base, lines 91–95 |

**Are changes tracked? Yes, once `account` is installed.**

1. **Tracking.** `account` adds `mail.thread` to `res.partner.bank`, with `tracking=True` on `bank_id`, `active`, `acc_number`, `acc_holder_name`, `partner_id`, `allow_out_payment` and `currency_id`. Source: account, lines 14, 36–49.
2. **Where changes are logged.** `write()` posts "Bank Account #id updated", with old and new values, on the **supplier's** chatter (`res.partner`). If the holder changed, the previous holder gets it too. Source: account, lines 271–324.
3. **Create and delete.** `create()` logs "Bank Account … created" on the partner; `unlink()` logs "… with number … deleted". Source: account, lines 256–269, 326–331.
4. **Trusted accounts are locked.** When `allow_out_payment` is true, `acc_number`, `partner_id` and `acc_type` can't change unless the same write un-trusts the account. Source: account, lines 289–312.

**Reading that history over RPC.**
- **Tracking values:** the `mail.tracking.value` model is readable only by `base.group_system` ([`mail/security/ir.model.access.csv`](https://github.com/odoo/odoo/blob/17.0/addons/mail/security/ir.model.access.csv), line 31).
- **The public route:** `mail.message.message_format()` returns `trackingValues` filtered by field groups ([`mail_message.py`](https://github.com/odoo/odoo/blob/17.0/addons/mail/models/mail_message.py), lines 954–1006, 1047).
- **The account itself:** any internal user may read `res.partner.bank` ([`base/security/ir.model.access.csv`](https://github.com/odoo/odoo/blob/17.0/odoo/addons/base/security/ir.model.access.csv), lines 76–77).

Whether the API user can see either belongs to #216.

**Which account a bill points at.** A vendor bill's `partner_bank_id` defaults to the vendor's first bank account, trusted accounts first. It is tracked and can be changed by hand. Source: [`account_move.py`](https://github.com/odoo/odoo/blob/17.0/addons/account/models/account_move.py), lines 355–365, 895–901.

## `stock.picking`: the receipts behind `picking_ids`

| Field | Type | Meaning or values | IPAS use | Source |
|---|---|---|---|---|
| `state` | Selection, stored, tracked | `draft`; `waiting` (waiting on another operation); `confirmed` Waiting; `assigned` Ready; `done`; `cancel` | Per-receipt detail behind `receipt_status` | [`stock/models/stock_picking.py`](https://github.com/odoo/odoo/blob/17.0/addons/stock/models/stock_picking.py), lines 419–433 |
| `date_done` | Datetime | When the transfer was processed | Per-receipt received date | stock_picking.py, line 454 |
| `origin` | Char | Source document; holds the PO number on a PO receipt | — | stock_picking.py, lines 400–402 |
| `purchase_id` | Many2one `purchase.order`, related, not stored | The PO behind the receipt's moves | Reverse link | [`purchase_stock/models/stock.py`](https://github.com/odoo/odoo/blob/17.0/addons/purchase_stock/models/stock.py), lines 11–13 |

Odoo receipts model only "received into stock". Nothing in these modules records Shipped Out, Onboard, Arrived in PH or Import Clearance.

## `stock.landed.cost`

`stock_landed_costs` is a Community (LGPL-3) module that depends on `stock_account` and `purchase_stock` ([`__manifest__.py`](https://github.com/odoo/odoo/blob/17.0/addons/stock_landed_costs/__manifest__.py)). Model source: [`addons/stock_landed_costs/models/stock_landed_cost.py`](https://github.com/odoo/odoo/blob/17.0/addons/stock_landed_costs/models/stock_landed_cost.py).

### How it links to a PO

**There is no purchase-order field.** A landed cost reaches a PO two ways:

1. **`picking_ids`:** the receipts it applies to. This is the reliable link. Search `stock.landed.cost` with `[('picking_ids', 'in', <po.picking_ids>)]`. The form only offers pickings in the same company that have stock valuation layers. Source: model lines 45–47; [`views/stock_landed_cost_views.xml`](https://github.com/odoo/odoo/blob/17.0/addons/stock_landed_costs/views/stock_landed_cost_views.xml), lines 38–40.
2. **`vendor_bill_id`:** the bill it was created from, with `account.move.landed_costs_ids` as the inverse. Clicking **Create Landed Costs** on a bill turns each line flagged `is_landed_costs_line` into a cost line. The flag is set by products marked "Is a Landed Cost". The bill is often a broker's or forwarder's, not the supplier's, so it need not be linked to the PO. Source: [`models/account_move.py`](https://github.com/odoo/odoo/blob/17.0/addons/stock_landed_costs/models/account_move.py); [landed costs doc](https://www.odoo.com/documentation/17.0/applications/inventory_and_mrp/inventory/product_management/inventory_valuation/landed_costs.html).

### Header fields

| Field | Type | Meaning or values | IPAS use | Source |
|---|---|---|---|---|
| `name` | Char | Sequence number | Reference on the IPAS | line 35 |
| `date` | Date, tracked | Landed cost date, which is also the journal entry date | Date the LC was booked | lines 38–40, 122 |
| `state` | Selection, tracked | `draft` Draft; `done` **Posted**; `cancel` Cancelled. Only drafts can be validated. A posted landed cost **cannot be cancelled**; Odoo says to reverse it with a negative landed cost. | Milestone **LC Odoo Done** = `done` | lines 58–62, 103–107, 282–284 |
| `target_model` | Selection | Always `picking` (Transfers) in Community | — | lines 41–44 |
| `picking_ids` | Many2many `stock.picking` | Receipts the cost applies to | PO link | lines 45–47 |
| `vendor_bill_id` | Many2one `account.move` | Bill it came from, limited to `in_invoice` | Link to the broker's bill | lines 73–74 |
| `cost_lines` | One2many `stock.landed.cost.lines` | The charges | **Payment Importation** rows | lines 48–50 |
| `valuation_adjustment_lines` | One2many `stock.valuation.adjustment.lines` | Each charge split across each receipt move | Per-item landed cost | lines 51–52 |
| `amount_total` | Monetary, stored, tracked | Sum of the cost lines' `price_unit` | Total importation charges booked | lines 55–57, 77–80 |
| `currency_id` | Many2one, related | **The company currency**, not the PO currency | Don't add it to a USD PO total unconverted | line 75 |
| `account_move_id`, `account_journal_id` | Many2one | Journal entry created on validation, and its journal | — | lines 63–69 |

### Cost lines (`stock.landed.cost.lines`)

| Field | Type | Meaning | Source |
|---|---|---|---|
| `name` | Char | Description | line 311 |
| `product_id` | Many2one `product.product`, required | The landed-cost product, for example "Brokerage Fee" | line 315 |
| `price_unit` | Monetary, required, company currency | Amount of the charge. From a bill, it is converted at the bill date. | line 316; stock_landed_costs `account_move.py` |
| `split_method` | Selection, required | See the split methods below. Defaults from the product's `split_method_landed_cost`, else `equal`. | lines 317–325; [`models/product.py`](https://github.com/odoo/odoo/blob/17.0/addons/stock_landed_costs/models/product.py) |
| `account_id` | Many2one `account.account` | Account for the charge | line 326 |

### Valuation adjustment lines (`stock.valuation.adjustment.lines`)

| Field | Meaning | Source |
|---|---|---|
| `cost_line_id`, `move_id`, `product_id` | Which charge, which receipt move, which product | lines 347–350 |
| `quantity`, `weight`, `volume` | Split bases taken from the move and product | lines 351–358 |
| `former_cost` | "Original Value": stock value of the move | lines 359–360 |
| `additional_landed_cost` | This move's share of the charge | lines 361–362 |
| `final_cost` | "New Value": `former_cost` + `additional_landed_cost` | lines 363–365 |

### Split methods

| Key | Label | Split by | Source |
|---|---|---|---|
| `equal` | Equal | Divided equally across each valuation line (product move), regardless of quantity | lines 11–17, 250–251 |
| `by_quantity` | By Quantity | Each move's quantity over the total quantity | lines 241–243 |
| `by_current_cost_price` | By Current Cost | Each move's `former_cost` over the total former cost | lines 252–254 |
| `by_weight` | By Weight | Product weight × quantity over the total weight | lines 244–246 |
| `by_volume` | By Volume | Product volume × quantity over the total volume | lines 247–249 |

**Fallback.** If the chosen basis totals zero, for example no product weights are set, the code falls back to an equal split without warning (lines 255–256).

### Preconditions

- **Setting.** The Landed Costs setting sits under Inventory settings, in the Valuation section, with a default journal ([doc](https://www.odoo.com/documentation/17.0/applications/inventory_and_mrp/inventory/product_management/inventory_valuation/landed_costs.html)).
- **Landed-cost products** must be of type Service.
- **Costing method.** The received products must use the **FIFO or AVCO** costing method; otherwise validation raises "Landed costs can only be applied for products with FIFO or average costing method" (lines 184–206).
- **Journal entry.** A journal entry is only created for products with automated (`real_time`) valuation; manual valuation still marks the landed cost `done` (lines 144–170).

## `account.move`: vendor bills

Source: [`addons/account/models/account_move.py`](https://github.com/odoo/odoo/blob/17.0/addons/account/models/account_move.py). The purchase links come from [`addons/purchase/models/account_invoice.py`](https://github.com/odoo/odoo/blob/17.0/addons/purchase/models/account_invoice.py).

| Field | Type | Meaning or values | IPAS use | Source |
|---|---|---|---|---|
| `move_type` | Selection | `in_invoice` Vendor Bill; `in_refund` Vendor Credit Note; `in_receipt` Purchase Receipt. The other values are journal entries and sales documents. | Filter `invoice_ids` down to bills | lines 147–163 |
| `state` | Selection, tracked | `draft`, `posted`, `cancel` | Bill created or posted | lines 134–146 |
| `payment_state` | Selection, stored, tracked | `not_paid`; `partial` Partially Paid; `in_payment` In Payment; `paid`; `reversed`; `invoicing_legacy`. It is only computed on posted bills; drafts read `not_paid`. `in_payment` means fully reconciled with a payment not yet matched to a bank statement. **Community returns `paid` in that case; the Enterprise accountant module overrides it to `in_payment`.** | Bill paid | lines 45–52, 481–487, 1018–1102; `_get_invoice_in_payment_state` |
| `ref` | Char, tracked | "Reference": the vendor's bill number | Supplier invoice number for filing | lines 121–126 |
| `invoice_date`, `invoice_date_due` | Date | Bill date and due date | Payment planning | lines 300–310 |
| `invoice_origin` | Char, readonly, tracked | Names of the source POs, comma-joined; set when lines are loaded from a PO | Cross-check against the PO | lines 551–557; purchase `account_invoice.py`, `_onchange_purchase_auto_complete` |
| `partner_bank_id` | Many2one `res.partner.bank`, tracked | "Recipient Bank": the vendor account to pay | **Bank Name**, **Account Name**, **Account #** | lines 355–365 |
| `invoice_payment_term_id` | Many2one | Payment terms | — | lines 317–323 |
| `currency_id`; `amount_untaxed`, `amount_tax`, `amount_total`, `amount_residual` | Many2one; Monetary, stored | Bill currency, totals, and "Amount Due" still unpaid. `*_signed` variants are in company currency. | Outstanding balance | lines 418–473 |
| `line_ids`, `invoice_line_ids` | One2many `account.move.line` | Journal items, and the product and layout subset of them | See below | lines 183–188, 291–297 |
| `invoice_payments_widget` | Binary (JSON), computed | Payments reconciled with a posted bill. Readable only by `account.group_account_invoice` or `account.group_account_readonly`. | One route from bill to payments | lines 407–411, 1232+ |
| `landed_costs_ids` | One2many `stock.landed.cost` | Landed costs created from this bill | LC link from a broker's bill | stock_landed_costs [`account_move.py`](https://github.com/odoo/odoo/blob/17.0/addons/stock_landed_costs/models/account_move.py) |
| `purchase_id` | Many2one `purchase.order`, **not stored** | Auto-complete helper on the bill form; always empty on read | **Don't use**. Go through `purchase.order.invoice_ids` or the lines. | purchase `account_invoice.py`, lines 22–24 |

**Bill line links** (`account.move.line`):
- `purchase_line_id` is a stored Many2one to `purchase.order.line`.
- `purchase_order_id` is related to that line's order. Source: purchase `account_invoice.py`, lines 478–479.
- Withholding amounts sit on tax lines: `tax_line_id` and `tax_base_amount`. Product lines carry `tax_ids`. Source: [`account_move_line.py`](https://github.com/odoo/odoo/blob/17.0/addons/account/models/account_move_line.py), lines 178, 195, 205.

## `account.payment`

Source: [`addons/account/models/account_payment.py`](https://github.com/odoo/odoo/blob/17.0/addons/account/models/account_payment.py). A payment `_inherits` `account.move` (line 9), so `state`, `date`, `ref`, `journal_id` and `currency_id` sit on its journal entry.

| Field | Type | Meaning or values | IPAS use | Source |
|---|---|---|---|---|
| `state` | Selection, from `move_id` | `draft`, `posted`, `cancel` | Payment made | line 9; `account_move.py` lines 134–146 |
| `date` | Date, from `move_id` | Payment date | Payment row **DATE** | line 9; `account_move.py` lines 127–133 |
| `amount` | Monetary | Amount in the payment currency | Payment row **Amount** | line 73 |
| `payment_type`, `partner_type` | Selection | `outbound` Send or `inbound` Receive; `supplier` Vendor or `customer` Customer | Filter to vendor payments | lines 74–81 |
| `partner_bank_id` | Many2one `res.partner.bank`, tracked | "Recipient Bank Account" | **Bank Name**, **Account Name**, **Account #** | lines 30–36 |
| `payment_method_line_id` | Many2one `account.payment.method.line` | Journal-configured method, for example Manual or Check | Not the IPAS Payment Scheme list | lines 49–57 |
| `payment_reference` | Char, tracked | "Reference of the document used to issue this payment", for example a check number | Free-text fallback for **Check No.** | lines 82–83 |
| `check_number` | Char, stored | Check number, only with `account_check_printing` and a check-printing method | **Check No.** | [`account_check_printing/models/account_payment.py`](https://github.com/odoo/odoo/blob/17.0/addons/account_check_printing/models/account_payment.py), lines 36–45 |
| `is_reconciled`, `is_matched` | Boolean, stored | Reconciled with a bill; matched with a bank statement line | Payment cleared | lines 22–25, 367+ |
| `reconciled_bill_ids` | Many2many `account.move`, computed, **not stored** | Bills this payment is reconciled with | Payment-to-PO route: payment → bill → `purchase.order.invoice_ids`. Readable, **not searchable**. | lines 129–133, 582+ |

**The payment gap.** A payment has no PO field in Community 17.0; the `purchase` addon has no `account_payment.py`. A down payment made **before** a bill exists, or never reconciled to one, is linked to the PO only through free text (`ref`, `payment_reference`) and the vendor. Only payments reconciled to the PO's bills can be attributed to it reliably.

## `l10n_ph` and BIR 2307

`l10n_ph` ("Philippines - Accounting") is Community, LGPL-3, and depends on `account` and `base_vat` ([`__manifest__.py`](https://github.com/odoo/odoo/blob/17.0/addons/l10n_ph/__manifest__.py)).

**What it produces.** A transient wizard, `l10n_ph_2307.wizard`, writes `Form_2307.xls`: one row per bill line per withholding tax. [`wizard/generate_2307_wizard.py`](https://github.com/odoo/odoo/blob/17.0/addons/l10n_ph/wizard/generate_2307_wizard.py) defines the columns:

| Column | Filled from |
|---|---|
| `Reporting_Month` | bill `invoice_date` (MM/dd/yyyy) |
| `Vendor_TIN` | partner `vat`, dashes stripped, first 9 digits |
| `branchCode` | partner `branch_code`, default `000` |
| `companyName` | partner name, if a company |
| `surName`, `firstName`, `middleName` | the partner's name parts, if an individual |
| `address`, `zip_code` | partner address |
| `nature` | tax description |
| `ATC` | tax `l10n_ph_atc` |
| `income_payment` | base amount |
| `ewt_rate` | tax rate |
| `tax_amount` | withholding amount |

The column map is at lines 12–27 and the row logic at lines 43–77.

**Where it starts.**
- **Vendor bills:** a server action, "Download BIR 2307 XLS", on the bill list and form. It keeps only `in_invoice`. Sources: [`views/account_move_views.xml`](https://github.com/odoo/odoo/blob/17.0/addons/l10n_ph/views/account_move_views.xml); [`models/account_move.py`](https://github.com/odoo/odoo/blob/17.0/addons/l10n_ph/models/account_move.py).
- **Payments:** the same action on one outbound payment's form. It exports that payment's `reconciled_bill_ids`. Sources: [`views/account_payment_views.xml`](https://github.com/odoo/odoo/blob/17.0/addons/l10n_ph/views/account_payment_views.xml); [`models/account_payment.py`](https://github.com/odoo/odoo/blob/17.0/addons/l10n_ph/models/account_payment.py).
- **Rights:** both actions require `account.group_account_invoice`.

**What it needs.**
- **An ATC on each withholding tax** (`account.tax.l10n_ph_atc`). Lines whose taxes have no ATC are **skipped**. Source: wizard, lines 69–70; [`models/account_tax.py`](https://github.com/odoo/odoo/blob/17.0/addons/l10n_ph/models/account_tax.py).
  - The chart template ships purchase withholding taxes with ATCs already set, as negative percentages. Examples: `1% WC640 - Supplier of goods`, `2% WC157 - Supplier of services`, and matching WI-coded taxes ([`data/template/account.tax-ph.csv`](https://github.com/odoo/odoo/blob/17.0/addons/l10n_ph/data/template/account.tax-ph.csv), lines 50–150).
  - The docs add that "the withholding taxes may need to be manually created" and that a manually created tax needs its ATC.
- **The vendor's TIN** in `vat`, formatted `NNN-NNN-NNN-NNNNN`. `branch_code` is computed from it.
- **Name parts for individuals:** `first_name`, `middle_name`, `last_name`. Source: [`models/res_partner.py`](https://github.com/odoo/odoo/blob/17.0/addons/l10n_ph/models/res_partner.py); [Philippines doc](https://www.odoo.com/documentation/17.0/applications/finance/fiscal_localizations/philippines.html), "Contacts".
- **The withholding tax applied on the bill lines.** If none is, the file has no rows for them (doc, "BIR 2307 report").

**What it does not do.** The docs are explicit:

> Odoo cannot generate the BIR 2307 PDF report or DAT files directly. The generated `Form_2307.xls` file can be exported to an *external* tool to convert it to BIR DAT or PDF format.

The wizard's docstring names that tool as `bir-excel-uploader.com` (lines 79–84).

**Over this project's RPC path.** Generating the file means:
1. creating a `l10n_ph_2307.wizard` record, which is a write;
2. calling `action_generate`;
3. downloading from `/web/content`, which needs a browser session.

`odoo.ts` already notes that the API key can't obtain a session, and #210 rules Odoo read-only. The workable options are:
- **Read the inputs and build the rows in the ERP:** bill lines, tax lines, `account.tax.l10n_ph_atc`, and the partner's `vat`, `branch_code` and name parts. `_prepare_invoice_aggregated_taxes` is private, so it can't be called over RPC.
- **Keep BIR 2307 as a filing checkbox** that Finance ticks.

## Caveats

1. **The public source is Community; the instance is `17.0+e`.** Enterprise modules can override what's described here. Three spots matter:
   - **`payment_state = in_payment`:** it needs the Enterprise accountant module's override; Community's `_get_invoice_in_payment_state` returns `paid`.
   - **The "Should Be Paid" field from 3-way matching:** it comes from `account_3way_match`, which is not in `odoo/odoo` 17.0, so it is described from the [bill control doc](https://www.odoo.com/documentation/17.0/applications/inventory_and_mrp/purchase/manage_deals/control_bills.html) only.
   - **The SLSP and 2550Q reports in the Philippines doc:** they need Enterprise reporting and aren't in public source. IPAS doesn't use them.
2. **"Billed" includes drafts.** `invoice_status = invoiced` and `qty_invoiced` count draft bills, and `invoice_ids` includes cancelled ones. Filter `invoice_ids` on `move_type` and `state`, and use `payment_state` for anything about money.
3. **`effective_date` is the first receipt, not the last.** Pair it with `receipt_status = full`, or read the receipts' `date_done`.
4. **Withholding tax on PO lines lowers the PO total.** The Philippine withholding taxes are negative-percentage purchase taxes, so a PO line carrying one reduces `amount_tax` and `amount_total`. `odoo-po-verify` reports `amount_total`; `odoo-po-rollup` already uses `amount_untaxed`.
5. **Datetimes are UTC.** `odoo-po-verify` slices `date_planned` to its first 10 characters, which is the UTC date. For times before 08:00 Manila, that is the previous day. The same applies to `effective_date` and `date_done`.
6. **Currencies differ by model.** PO and bill amounts are in the document currency. Landed-cost amounts are in the company currency.
7. **The docs over-state 2307's scope.** They say BIR 2307 data "can be generated for purchase orders and vendor payments". The code binds the action only to vendor bills (`in_invoice`) and outbound payments, never to `purchase.order`.
8. **Out of scope here (#216):** which modules are installed on the instance (`purchase_stock`, `stock_landed_costs`, `account_check_printing`, `l10n_ph`), products' costing methods, whether the four entities are companies, and what the API user may read. In particular that means `res.partner.bank`, `invoice_payments_widget` and chatter tracking.
