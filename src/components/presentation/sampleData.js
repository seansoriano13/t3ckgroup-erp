/**
 * Made-up data for the deck's samples. None of it is read from, or written to,
 * the database: the ids are not UUIDs and match no row.
 */

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
  sales_reference: "S99002",
  client_name: "Demo City LGU",
  project_title: "Demo B - medical equipment",
  project_type: "SUPPLY",
  sale_type_id: SALE_TYPE_ID,
  flow_stage_id: "s-bid",
  flow_snapshot_id: "sample-snapshot",
  expected_value: 1250000,
  status: "BID_SUBMITTED",
  deal_owner: { id: "e1", name: "Maria Duran", avatar_path: null },
}

// The Board reads no snapshot here, so its SORs are not pinned to one.
export const SAMPLE_BOARD_OPPORTUNITIES = [
  { ...SAMPLE_OPPORTUNITY, flow_snapshot_id: null, id: "b1", sales_reference: "S99001", client_name: "Demo Hospital", flow_stage_id: "s-lead", expected_value: 480000 },
  { ...SAMPLE_OPPORTUNITY, flow_snapshot_id: null, id: "b2", sales_reference: "S99002", flow_stage_id: "s-tech" },
  { ...SAMPLE_OPPORTUNITY, flow_snapshot_id: null, id: "b3", sales_reference: "S99003", client_name: "Demo Province", flow_stage_id: "s-bid", expected_value: 3100000 },
  { ...SAMPLE_OPPORTUNITY, flow_snapshot_id: null, id: "b4", sales_reference: "S99004", client_name: "Demo School", flow_stage_id: "s-bid", expected_value: 210000 },
  { ...SAMPLE_OPPORTUNITY, flow_snapshot_id: null, id: "b5", sales_reference: "S99005", client_name: "Demo Clinic", flow_stage_id: "s-won", expected_value: 890000 },
]

export const SAMPLE_FLOW_STAGES_INDEX = {
  flowsById: { [FLOW_ID]: SAMPLE_FLOW },
  stagesByFlow: { [FLOW_ID]: SAMPLE_STAGES },
  stagesById: Object.fromEntries(SAMPLE_STAGES.map((s) => [s.id, s])),
}

/** An Odoo stock snapshot: three products with free stock, plus one warehouse. */
export const STOCK_SNAPSHOT = {
  warehouses: [{ id: "w1", name: "Main warehouse" }],
  products: {
    1: { type: "product", free: 18, onHand: 20, forecast: 18, byWarehouse: { w1: { onHand: 20, free: 18, forecast: 18 } } },
    2: { type: "product", free: 4, onHand: 6, forecast: 4, byWarehouse: { w1: { onHand: 6, free: 4, forecast: 4 } } },
    3: { type: "product", free: 0, onHand: 0, forecast: 0, byWarehouse: { w1: { onHand: 0, free: 0, forecast: 0 } } },
  },
}

/** The published version the sample SOR is pinned to: v2.1. */
export const SAMPLE_SNAPSHOT = { id: "sample-snapshot", version: 2, version_minor: 1, created_at: "2026-09-10T00:00:00Z" }
