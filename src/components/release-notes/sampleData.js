/**
 * Sample Data for Release Notes (ADR 0030). Made up, and made to look made up:
 * people nobody at the company is called, clients prefixed "Demo", round
 * figures. None of it is read from or written to the database; the ids are not
 * UUIDs and match no row.
 */

export const SAMPLE_ACTOR = "sample-actor"

const DAY = 86400000
export const daysAgo = (n) => new Date(Date.now() - n * DAY).toISOString()
export const inDays = (n) => new Date(Date.now() + n * DAY).toISOString()
export const hoursAgo = (n) => new Date(Date.now() - n * 3600000).toISOString()
export const isoDate = (offsetDays = 0) => {
  const d = new Date(Date.now() + offsetDays * DAY)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

/** The cast. Every sample picks from these, so the same names recur. */
export const PEOPLE = {
  lara: { id: "p-lara", name: "Lara Mendoza", department: "SALES", sub_department: "GOVERNMENT", avatar_path: null },
  paolo: { id: "p-paolo", name: "Paolo Reyes", department: "SALES", sub_department: "PRIVATE", avatar_path: null },
  joy: { id: "p-joy", name: "Joy Villanueva", department: "OPERATIONS", sub_department: "PURCHASING", avatar_path: null },
  carlo: { id: "p-carlo", name: "Carlo Bautista", department: "OPERATIONS", sub_department: "TECHNICAL", avatar_path: null },
  nina: { id: "p-nina", name: "Nina Ocampo", department: "HR", sub_department: "HR", avatar_path: null },
  mark: { id: "p-mark", name: "Mark Dizon", department: "SALES", sub_department: "GOVERNMENT", avatar_path: null },
}
export const SAMPLE_EMPLOYEES = Object.values(PEOPLE)

export const SALE_TYPE_ID = "sample-sale-type"
export const FLOW_ID = "sample-flow"

const stage = (id, name, order, extra = {}) => ({
  id,
  flow_id: FLOW_ID,
  name,
  sort_order: order,
  pos_x: order * 300,
  pos_y: 0,
  is_terminal: false,
  color: null,
  bracket_label: null,
  ...extra,
})

export const SAMPLE_STAGES = [
  stage("s-lead", "Lead", 1),
  stage("s-tech", "Technical Review", 2),
  stage("s-bid", "Bid Submitted", 3),
  stage("s-won", "Awarded", 4, { is_terminal: true }),
  stage("s-lost", "Closed Lost", 5, { is_terminal: true }),
]

const edge = (id, from, to) => ({ id, flow_id: FLOW_ID, from_stage_id: from, to_stage_id: to })

export const SAMPLE_EDGES = [
  edge("e1", "s-lead", "s-tech"),
  edge("e2", "s-tech", "s-bid"),
  edge("e3", "s-bid", "s-won"),
  edge("e4", "s-bid", "s-lost"),
]

export const SAMPLE_FLOW = {
  id: FLOW_ID,
  sale_type_id: SALE_TYPE_ID,
  won_stage_id: "s-won",
  state: "published",
}

export const SAMPLE_SALE_TYPE = { id: SALE_TYPE_ID, name: "Government", archived_at: null }

export const SAMPLE_CANVAS = {
  flow: SAMPLE_FLOW,
  saleType: SAMPLE_SALE_TYPE,
  stages: SAMPLE_STAGES,
  edges: SAMPLE_EDGES,
}

/** An SOR on the Bid Submitted stage of the sample flow. */
export const SAMPLE_OPPORTUNITY = {
  id: "sample-opp",
  opportunity_no: "OPP-0001",
  sales_reference: "S00002",
  client_name: "Demo City Hospital",
  project_title: "Demo: 10 hospital beds",
  contact_person: "Demo Contact",
  project_type: "SSP",
  lead_source: null,
  registration_date: daysAgo(20),
  expected_award_date: inDays(25),
  sale_type_id: SALE_TYPE_ID,
  flow_stage_id: "s-bid",
  flow_snapshot_id: null,
  expected_value: 1000000,
  status: "BID_SUBMITTED",
  deal_owner: PEOPLE.lara,
  sales_director: PEOPLE.mark,
  support_1: null,
  support_2: null,
  closing_sales: null,
}

export const SAMPLE_BOARD_OPPORTUNITIES = [
  { ...SAMPLE_OPPORTUNITY, id: "b1", sales_reference: "S00001", client_name: "Demo Clinic", project_title: "Demo: patient monitors", flow_stage_id: "s-lead", expected_value: 500000 },
  { ...SAMPLE_OPPORTUNITY, id: "b2", flow_stage_id: "s-tech" },
  { ...SAMPLE_OPPORTUNITY, id: "b3", sales_reference: "S00003", client_name: "Demo Province", project_title: "Demo: rescue equipment", flow_stage_id: "s-bid", expected_value: 3000000 },
  { ...SAMPLE_OPPORTUNITY, id: "b4", sales_reference: "S00004", client_name: "Demo School", project_title: "Demo: first-aid kits", flow_stage_id: "s-bid", expected_value: 200000, deal_owner: PEOPLE.paolo },
  { ...SAMPLE_OPPORTUNITY, id: "b5", sales_reference: "S00005", client_name: "Demo Town Hall", project_title: "Demo: ambulance", flow_stage_id: "s-won", expected_value: 2000000 },
]

export const SAMPLE_FLOW_STAGES_INDEX = {
  flowsById: { [FLOW_ID]: SAMPLE_FLOW },
  stagesByFlow: { [FLOW_ID]: SAMPLE_STAGES },
  stagesById: Object.fromEntries(SAMPLE_STAGES.map((s) => [s.id, s])),
}

/** Product List lines: three stocked products and a charge. */
export const SAMPLE_LINES = [
  { product_name: "Demo hospital bed, manual", unit: "unit", quantity: 10, unit_price: 50000, odoo_product_id: 1 },
  { product_name: "Demo mattress, foam", unit: "pc", quantity: 10, unit_price: 20000, odoo_product_id: 2 },
  { product_name: "Demo IV pole", unit: "pc", quantity: 20, unit_price: 10000, odoo_product_id: 3 },
  { product_name: "Delivery charge", unit: "lot", quantity: 1, unit_price: 100000, odoo_product_id: null },
]

/** An Odoo stock snapshot for the lines above, plus one warehouse. */
export const STOCK_SNAPSHOT = {
  warehouses: [{ id: "w1", name: "Main warehouse" }],
  products: {
    1: { type: "product", free: 18, onHand: 20, forecast: 18, byWarehouse: { w1: { onHand: 20, free: 18, forecast: 18 } } },
    2: { type: "product", free: 4, onHand: 6, forecast: 4, byWarehouse: { w1: { onHand: 6, free: 4, forecast: 4 } } },
    3: { type: "product", free: 0, onHand: 0, forecast: 0, byWarehouse: { w1: { onHand: 0, free: 0, forecast: 0 } } },
  },
}
