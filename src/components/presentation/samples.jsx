import { useState } from "react"
import { ReactFlowProvider } from "@xyflow/react"
import FlowCanvasNode from "../settings/FlowCanvasNode"
import ChoiceOptionsEditor from "../settings/ChoiceOptionsEditor"
import StageFieldPreview from "../settings/StageFieldPreview"
import MySorRow from "../sor/MySorRow"
import { ItemStockRow } from "../sor/modal/ItemsTab"

/**
 * The real components, fed made-up data, so a row can show what the screen
 * looks like without a network call (ADR 0022). Nothing here is a picture of a
 * component: each is the one the app renders, given props instead of a query.
 *
 * Every sample is labelled as sample data by the slide that mounts it. The map
 * from a row's `sample` key to a component lives in sampleRegistry.js, so this
 * file exports components and nothing else.
 */

const stage = (name, extra = {}) => ({ id: name, name, color: "mauve", is_terminal: false, ...extra })

const person = (name, employeeId) => ({ employeeId, name, calls: [] })

function NodeSample({ name, ...data }) {
  return (
    <ReactFlowProvider>
      <FlowCanvasNode
        data={{
          stage: stage(name, data.stage),
          isEntry: false,
          isWon: false,
          disabled: true,
          conditionCount: 0,
          actionCount: 0,
          fieldCount: 0,
          ...data,
        }}
      />
    </ReactFlowProvider>
  )
}

const noAudience = { calledIn: [], shutOutGroups: [], counts: { calledIn: 0, shutOutRoles: 0 } }

/* ── My SORs ────────────────────────────────────────────────────────────── */

export function MySorsSample() {
  const rows = [
    {
      opportunityId: "sample-1",
      salesReference: "S99002",
      projectTitle: "Demo B",
      currentStageName: "Bid Submitted",
      isOpen: true,
      windows: [
        {
          id: "w1",
          calledInAtStageName: "Technical Review",
          source: "action",
          reachLabel: "the rest of the SOR",
          closedAt: null,
        },
      ],
    },
    {
      opportunityId: "sample-2",
      salesReference: "S99001",
      projectTitle: "Demo A",
      currentStageName: "Costing",
      isOpen: false,
      windows: [
        {
          id: "w2",
          calledInAtStageName: "Costing",
          source: "assignment",
          reachLabel: "this Stage only",
          closedAt: "2026-09-20",
        },
      ],
    },
  ]
  return (
    <div className="max-w-2xl space-y-3">
      {rows.map((row) => (
        <MySorRow key={row.opportunityId} row={row} onOpen={() => {}} />
      ))}
    </div>
  )
}

/* ── Stock on the Product List ──────────────────────────────────────────── */

const LINES = [
  { id: "a", name: "Stretcher, hydraulic", quantity: 12, odoo_product_id: 1 },
  { id: "b", name: "Mattress, foam 4in", quantity: 12, odoo_product_id: 2 },
  { id: "c", name: "IV pole, 4-hook", quantity: 24, odoo_product_id: 3 },
  { id: "d", name: "Delivery charge", quantity: 1, odoo_product_id: null },
]

const SNAPSHOT = {
  warehouses: [{ id: "w1", name: "Main warehouse" }],
  products: {
    1: { type: "product", free: 18, onHand: 20, forecast: 18, byWarehouse: { w1: { onHand: 20, free: 18, forecast: 18 } } },
    2: { type: "product", free: 4, onHand: 6, forecast: 4, byWarehouse: { w1: { onHand: 6, free: 4, forecast: 4 } } },
    3: { type: "product", free: 0, onHand: 0, forecast: 0, byWarehouse: { w1: { onHand: 0, free: 0, forecast: 0 } } },
  },
}

export function StockSample() {
  return (
    <div className="grid max-w-2xl grid-cols-12 gap-x-3 gap-y-3 rounded-2xl border border-border bg-card p-4">
      {LINES.map((line) => (
        <div key={line.id} className="col-span-12 space-y-1">
          <div className="flex justify-between text-[14px] font-medium text-foreground">
            <span>{line.name}</span>
            <span className="text-muted-foreground">x{line.quantity}</span>
          </div>
          <div className="grid grid-cols-12">
            <ItemStockRow item={line} snapshotData={SNAPSHOT} />
          </div>
        </div>
      ))}
    </div>
  )
}

/* ── Flow Canvas: who sees a Stage ──────────────────────────────────────── */

export function StageAccessSample() {
  return (
    <div className="flex flex-wrap items-start gap-6">
      <NodeSample name="Technical Review" audience={noAudience} />
      <NodeSample
        name="Bid Submitted"
        audience={{
          calledIn: [person("Maria Duran", "e1"), person("Raquel Galacgac", "e2")],
          shutOutGroups: [],
          counts: { calledIn: 2, shutOutRoles: 0, shutOutPeople: 0 },
        }}
      />
      <NodeSample
        name="Costing"
        audience={{
          calledIn: [],
          shutOutGroups: [],
          counts: { calledIn: 0, shutOutRoles: 2, shutOutPeople: 0 },
        }}
      />
    </div>
  )
}

/* ── Flow Canvas: editing a Stage ───────────────────────────────────────── */

export function CanvasEditingSample() {
  const [options, setOptions] = useState(["Public bidding", "Direct contracting", "Negotiated"])
  const draft = {
    label: "Procurement mode",
    source: "custom",
    sorField: null,
    isRequired: true,
    help: "As stated in the bid documents.",
    fieldType: "choice",
    options,
  }
  return (
    <div className="flex flex-wrap items-start gap-8">
      <NodeSample
        name="Bidding"
        conditionCount={2}
        actionCount={1}
        fieldCount={3}
        audience={noAudience}
      />
      <div className="w-full max-w-sm space-y-3">
        <ChoiceOptionsEditor options={options} onChange={setOptions} />
        <StageFieldPreview draft={draft} />
      </div>
    </div>
  )
}

/* ── Stage Fields ───────────────────────────────────────────────────────── */

export function StageFieldsSample() {
  return (
    <div className="grid max-w-3xl gap-4 md:grid-cols-2">
      <StageFieldPreview
        draft={{
          label: "ITB Number",
          source: "custom",
          isRequired: true,
          help: "Only if this SOR has an Invitation to Bid.",
          fieldType: "text",
          options: [],
        }}
      />
      <StageFieldPreview
        draft={{
          label: "Bid Deadline",
          source: "custom",
          isRequired: false,
          help: "",
          fieldType: "date",
          options: [],
        }}
      />
    </div>
  )
}
