/**
 * A printable IPAS as `ipasService.get` returns it, for the print view model and
 * composer tests (#250). Built through the real `shapeIpas`, so the fixture has
 * the same shape the service produces: a test that passes here reads what the
 * page reads.
 *
 * The default is TGIPAS_050, an imported order on S07983, open, with two of
 * section 1 and 3's sign-offs given, section 7 not yet opened, and Odoo read at
 * 09:12 Manila time on Sep 15, 2026.
 */

import { shapeBankDetails, shapeIpas } from "@/utils/ipas"
import { computeLandedCost } from "@/test/stubs/landedCostFake"

const OPTIONS = [
  { id: "opt-bank-tt", list: "payment_method", label: "Bank TT", active: true, sort: 1 },
  { id: "opt-brokerage", list: "charge_kind", label: "Brokerage Fee", active: true, sort: 1 },
  { id: "opt-duties", list: "charge_kind", label: "Duties & Taxes", active: true, sort: 2 },
  { id: "opt-pi", list: "document_kind", label: "Proforma Invoice", applies_to: "import", used_for: "doc", active: true, sort: 1 },
  { id: "opt-waybill", list: "document_kind", label: "Waybill", applies_to: "import", used_for: "both", active: true, sort: 2 },
  { id: "opt-2307", list: "document_kind", label: "BIR 2307", applies_to: "both", used_for: "filing", active: true, sort: 3 },
  { id: "opt-loc", list: "item_location", label: "BM Office", active: true, sort: 1 },
]

export const signoffRow = (section, role, who, over = {}) => ({
  id: `${section}-${role}`,
  ipas_id: "ipas-50",
  section,
  role,
  signed_by: who.id,
  signer: { id: who.id, name: who.name, avatar_path: null },
  signed_at: "2026-09-12T06:05:00.000Z",
  signature_declined: false,
  signature_version: `${who.id}/signature.png`,
  cleared_at: null,
  cleared_by: null,
  cleared_reason: null,
  ...over,
})

export const BAUTISTA = { id: "emp-bautista", name: "J. Bautista" }
export const RAMOS = { id: "emp-ramos", name: "M. Ramos" }
export const CRUZ = { id: "emp-cruz", name: "R. Cruz" }

/** The raw `ipas` row, with whatever a test overrides. */
export const ipasRow = (over = {}) => ({
  id: "ipas-50",
  number: "TGIPAS_050",
  po_number: "P02445",
  state: "open",
  priority: "high",
  source: "import",
  purpose: "project",
  remarks: "Internal note",
  created_at: "2026-09-02T02:00:00.000Z",
  creator: { id: BAUTISTA.id, name: BAUTISTA.name },
  odoo_fetched_at: "2026-09-15T01:12:00.000Z",
  odoo_copy: {
    po: {
      name: "P02445",
      state: "purchase",
      company: "TG Enterprise",
      currency: "USD",
      origin: "S07983",
      partner_ref: "PI-RL-2026-118",
    },
    supplier: { id: 9, name: "Redleaf Medical Supplies", contact: "Ms. K. Tan" },
    lines: [
      {
        line_id: 1,
        name: "Ambulance Folding Stretcher",
        quantity: 2,
        unit: "Unit",
        price_unit: 640,
        price_subtotal: 1280,
        taxes: [],
        analytic: ["S07983 Emergency Response Vehicle"],
        brand: "Redleaf",
      },
    ],
    receipts: { status: "partial", done: 1, total: 2 },
    bills: { count: 1, draft: 1 },
  },
  supplier_contact: "Ms. K. Tan",
  pi_number: "PI-RL-2026-118",
  pi_qt_amount: 1280,
  entity_override: null,
  source_doc_override: null,
  analytic_override: null,
  computation_status: "encoded",
  landed_cost_split: "value",
  item_location_id: "opt-loc",
  shipped_out_on: "2026-09-05",
  onboard_on: "2026-09-06",
  arrived_in_ph_on: "2026-09-09",
  arrived_in_whs_on: null,
  import_clearance_on: null,
  delivered_on: "2026-09-14",
  delivered_typed_by: BAUTISTA.id,
  delivered_typer: { id: BAUTISTA.id, name: BAUTISTA.name },
  delivered_typed_at: "2026-09-14T03:00:00.000Z",
  actual_checking_by: null,
  filed_at: null,
  ...over,
})

const PAYMENTS = [
  {
    id: "pay-1",
    ipas_id: "ipas-50",
    kind: "down_payment",
    paid_on: "2026-09-03",
    amount: 640,
    php_debited: 36160,
    charge_fee_php: 350,
    method_id: "opt-bank-tt",
    check_no: null,
    proof_url: "https://files.example/pop-1.pdf",
  },
  {
    id: "pay-2",
    ipas_id: "ipas-50",
    kind: "shipping_fee",
    paid_on: "2026-09-10",
    amount: 120,
    php_debited: 6800,
    charge_fee_php: 0,
    method_id: "opt-bank-tt",
    check_no: null,
    proof_url: null,
  },
]

const CHARGES = [
  { id: "chg-1", ipas_id: "ipas-50", kind_id: "opt-brokerage", charged_on: "2026-09-12", amount_php: 4200 },
  { id: "chg-2", ipas_id: "ipas-50", kind_id: "opt-duties", charged_on: "2026-09-12", amount_php: 9870 },
]

const DOCUMENTS = [
  { id: "doc-pi", ipas_id: "ipas-50", kind_id: "opt-pi", label: null, purchasing_has: true, finance_has: true, created_at: "2026-09-02T02:00:01Z" },
  { id: "doc-wb", ipas_id: "ipas-50", kind_id: "opt-waybill", label: null, purchasing_has: true, finance_has: false, created_at: "2026-09-02T02:00:02Z" },
  { id: "doc-2307", ipas_id: "ipas-50", kind_id: "opt-2307", label: null, purchasing_has: false, finance_has: false, created_at: "2026-09-02T02:00:03Z" },
]

const SORS = [
  { opportunity_id: "opp-1", sales_reference: "S07983", project_title: "Emergency Response Vehicle", current_stage_name: "Quotation" },
]

/**
 * A printable IPAS. `row` overrides the stored row; `extras` replaces the
 * payments, charges, documents, options and signoffs; `bank` is the bank
 * details row (null for none); `canReadBankDetails` is the database's answer.
 */
export function makePrintableIpas({
  row = {},
  extras = {},
  sors = SORS,
  bank = { bank_name: "BDO Unibank", account_name: "Redleaf Medical Supplies", account_number: "0012 3456 7890 4417", account_flagged: false },
  canReadBankDetails = true,
  refresh = null,
  signoffs,
} = {}) {
  const sign = signoffs ?? [
    signoffRow(1, "prepared", BAUTISTA),
    signoffRow(1, "approved", RAMOS),
    signoffRow(3, "prepared", BAUTISTA),
  ]
  const full = ipasRow(row)
  const sections = { payments: PAYMENTS, charges: CHARGES, documents: DOCUMENTS, options: OPTIONS, signoffs: sign, ...extras }
  // What ipas_landed_cost returns for these rows (#283: the database works it out; the fake's copy here).
  const landedCost =
    sections.landedCost ??
    computeLandedCost({
      copy: full.odoo_copy,
      payments: sections.payments,
      charges: sections.charges,
      split: full.landed_cost_split || "value",
      computationStatus: full.computation_status || "encoding",
      filed: full.state === "filed",
    })
  const shaped = shapeIpas(full, sors, { ...sections, landedCost })
  return {
    ...shaped,
    bankDetails: canReadBankDetails ? shapeBankDetails(bank) : null,
    canReadBankDetails,
    refresh,
  }
}
