import { useState } from "react"
import { ArrowRight, Minus, Plus } from "lucide-react"
import toast from "react-hot-toast"
import { SampleAuthProvider } from "@/context/AuthContext"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import CorridorScreen from "../costing/desk/corridor/CorridorScreen"
import { waterfallSteps } from "../costing/desk/corridor/sheetModel"
import { goFloor } from "../costing/desk/corridor/goFloor"
import { Cell } from "../costing/GridCell"
import { pesos } from "../costing/gridFormat"
import { shapeMatrix } from "../../services/costingMatrixService"
import { ABC_MODE, COSTING_BAND, COSTING_TIER, DEFAULT_COSTING_SETTINGS } from "../../constants/costing"
import { finalAcquireByRule, summary } from "../../utils/costingMath"
import SampleProvider, { SAMPLE_SAVE_BLOCKED } from "./SampleProvider"
import { Lines, MockButton } from "./motion"
import { useScene } from "./useScene"
import { PEOPLE, isoDate } from "./sampleData"

/**
 * The S0 Evaluation (Beta) tab. The price corridor is the real screen, fed a made-up evaluation
 * that lives in this page's memory only: every box the reader types in is worked again with the
 * app's own maths (shapeMatrix, costingMath), so the corridor, the Go floor and Revenue move as
 * they would, and nothing reaches the database. Deciding and signing stay off. The Go line
 * waterfall uses the same `summary`. The rest are drawn scenes.
 * Throwaway (ADR 0030, 2026-11 amendment).
 */

const blocked = () => toast(SAMPLE_SAVE_BLOCKED, { id: "sample-save-blocked" })

/* ------------------------------------------------------------------ a made-up evaluation, kept in memory */

const MATRIX_ID = "sample-matrix"
const OPPORTUNITY = {
  id: "sample-sor",
  sor_code: "SOR-0412",
  project_title: "Demo radio network",
  sales_reference: "S01234",
  client_name: "Demo City Hall",
  deal_owner_id: PEOPLE.lara.id,
  standalone: false,
}
const VIEWER = { id: "sample-viewer", name: "Sample Viewer", department: "SALES", isSuperAdmin: false }
const BANDS = [COSTING_BAND.SALES, COSTING_BAND.PURCHASING, COSTING_BAND.MANAGEMENT, COSTING_BAND.MARKUP, COSTING_BAND.FINANCE]
const EMPLOYEES = [
  { ...PEOPLE.lara },
  { ...PEOPLE.joy, has_purchasing_flow: true },
  { ...PEOPLE.carlo, department: "OPERATIONS", sub_department: "TECHNICAL" },
  { ...PEOPLE.mark },
]

const part = (id, line, position, name, status, { acquire = null, srp = null, quantity = 1, unit = "pc" } = {}) => ({
  component: { id, tender_line_id: line, position, name, brand: "Demo", quantity, unit, status, compliance: "complies" },
  cost: { component_id: id, acquire_unit: acquire, odoo_unit: srp, final_acquire_unit: null, final_acquire_typed: false, final_acquire_percent: null, markup_factor: null },
})
const costRow = (id, category, description, { pct = null, amount = null } = {}) => ({
  id, matrix_id: MATRIX_ID, category_key: category, description, quantity: 1, abc_pct: pct, acquire_unit: amount, final_acquire_unit: null,
})

/**
 * Where the evaluation starts. The screen opens on the first step with something left, so each
 * variant leaves a gap where its item is: "final-acquire" a part with no Status, "other-costs" a
 * missing usual cost and a blank Marketing; "offers" leaves nothing, and opens on Offers.
 */
function startTables(variant) {
  const parts = [
    part("cp-1", "tl-1", 1, "Handheld radio", "stockable", { acquire: 11000, srp: 15000, quantity: 10 }),
    part("cp-2", "tl-2", 1, "Base station", "source_out", { acquire: 72000, unit: "set" }),
    part("cp-3", "tl-2", 2, "Antenna kit", variant === "final-acquire" ? null : "stockable", { acquire: 6500, srp: 10000, unit: "set" }),
  ]
  const rows = [
    costRow("cr-1", "labor", "Installation crew", { pct: 4 }),
    costRow("cr-2", "logistics", "Delivery to site", { pct: 2 }),
    costRow("cr-3", "equipment", "Tower rental", { amount: 2500 }),
    costRow("cr-4", "permits", "Site permits", { pct: 0.5 }),
    costRow("cr-5", "overhead", "Overhead", { pct: 1 }),
  ].filter((row) => !(variant === "other-costs" && row.category_key === "permits"))
  return {
    costing_matrices: [
      {
        id: MATRIX_ID,
        opportunity_id: OPPORTUNITY.id,
        abc_mode: ABC_MODE.BY_LINE,
        abc_total: null,
        offer_mode: ABC_MODE.BY_LINE,
        offer_total: null,
        sales_incharge_id: PEOPLE.lara.id,
        purchasing_incharge_id: PEOPLE.joy.id,
        technical_incharge_id: PEOPLE.carlo.id,
        compliance: "complies",
        compliance_note: null,
        import_addon_percent: 0,
      },
    ],
    costing_matrix_money: [{ matrix_id: MATRIX_ID, default_factor: 1.35, default_preset_id: null, final_acquire_percent: -20, marketing: variant === "other-costs" ? null : 5000 }],
    costing_tender_lines: [
      { id: "tl-1", matrix_id: MATRIX_ID, position: 1, tender_specification: "Demo rugged handheld radio", unit: "pc", quantity: 10, source: "typed" },
      { id: "tl-2", matrix_id: MATRIX_ID, position: 2, tender_specification: "Demo radio base station", unit: "set", quantity: 1, source: "typed" },
    ],
    costing_tender_line_prices: [
      { tender_line_id: "tl-1", abc_unit: 30000, final_offer_unit: 28000 },
      { tender_line_id: "tl-2", abc_unit: 200000, final_offer_unit: 190000 },
    ],
    costing_components: parts.map((p) => p.component),
    costing_component_costs: parts.map((p) => p.cost),
    costing_cost_rows: rows,
    costing_signoffs: [{ id: "so-1", matrix_id: MATRIX_ID, role: "evaluation_approved", signed_by: PEOPLE.carlo.id, signed_at: isoDate(-1), cleared_at: null }],
    costing_bid_decisions: [],
  }
}

// What the database does on its own: Final Acquire follows the rule unless someone typed over it (#962).
function withRule(tables) {
  const percent = tables.costing_matrix_money[0].final_acquire_percent
  const byId = new Map(tables.costing_components.map((c) => [c.id, c]))
  return {
    ...tables,
    costing_component_costs: tables.costing_component_costs.map((cost) =>
      cost.final_acquire_typed ? cost : { ...cost, final_acquire_unit: finalAcquireByRule({ ...byId.get(cost.component_id), ...cost }, percent) },
    ),
  }
}

function shape(tables) {
  const matrix = shapeMatrix({ tier: COSTING_TIER.CLOSED_BOOK, bands: BANDS, matrix_id: MATRIX_ID, tables: withRule(tables) }, DEFAULT_COSTING_SETTINGS)
  matrix.canDecideLoss = true
  return matrix
}

const snake = (key) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
const COMPONENT_OWN = new Set(["status", "name", "brand", "quantity", "unit"])
const LINE_PRICES = new Set(["abc_unit", "final_offer_unit"])
let newRowId = 0

/** The saves the corridor makes, done on the in-memory evaluation instead of the database. */
function useSampleEvaluation(variant) {
  const [tables, setTables] = useState(() => startTables(variant))
  // The tables are plain data, so a JSON copy is a full copy.
  const edit = (fn) => {
    setTables((t) => fn(JSON.parse(JSON.stringify(t))))
    return Promise.resolve()
  }
  const setOn = (pick, fields) =>
    edit((t) => {
      Object.assign(pick(t), fields)
      return t
    })
  const patchRow = (rows, match, fields) => rows.map((row) => (match(row) ? { ...row, ...fields } : row))
  const save = {
    line: (lineId, fields) =>
      edit((t) => {
        for (const [key, value] of Object.entries(fields)) {
          const col = snake(key)
          if (LINE_PRICES.has(col)) t.costing_tender_line_prices = patchRow(t.costing_tender_line_prices, (p) => p.tender_line_id === lineId, { [col]: value })
          else t.costing_tender_lines = patchRow(t.costing_tender_lines, (l) => l.id === lineId, { [col]: value })
        }
        return t
      }),
    part: (partId, fields) =>
      edit((t) => {
        for (const [key, value] of Object.entries(fields)) {
          const col = snake(key)
          if (COMPONENT_OWN.has(col)) t.costing_components = patchRow(t.costing_components, (c) => c.id === partId, { [col]: value })
          else {
            const extra = col === "final_acquire_unit" ? { final_acquire_typed: value !== null } : {}
            t.costing_component_costs = patchRow(t.costing_component_costs, (c) => c.component_id === partId, { [col]: value, ...extra })
          }
        }
        return t
      }),
    costRow: (rowId, fields) =>
      edit((t) => {
        const cols = Object.fromEntries(Object.entries(fields).map(([k, v]) => [snake(k), v]))
        t.costing_cost_rows = patchRow(t.costing_cost_rows, (r) => r.id === rowId, cols)
        return t
      }),
    addCostRow: ({ categoryKey, description, acquireUnit = null, abcPct = null }) =>
      edit((t) => {
        newRowId += 1
        t.costing_cost_rows.push(costRow(`cr-new-${newRowId}`, categoryKey, description ?? "", { pct: abcPct, amount: acquireUnit }))
        return t
      }),
    addCost: (categoryKey) => save.addCostRow({ categoryKey, description: "" }),
    removeCostRow: (rowId) =>
      edit((t) => {
        t.costing_cost_rows = t.costing_cost_rows.filter((r) => r.id !== rowId)
        return t
      }),
    marketing: (value) => setOn((t) => t.costing_matrix_money[0], { marketing: value }),
    // The same refusal as the real save (#1034): 99.995 and up would round to 100.
    finalAcquireDiscount: (value) => {
      const raw = Number(value)
      if (value === "" || value == null || !Number.isFinite(raw) || raw >= 99.995) return Promise.reject(new Error("Type a discount below 100, like 20."))
      const n = Math.round(raw * 100) / 100
      return setOn((t) => t.costing_matrix_money[0], { final_acquire_percent: n === 0 ? 0 : -n })
    },
    defaultFactor: (value) => setOn((t) => t.costing_matrix_money[0], { default_factor: value }),
    abc: (patch) => setOn((t) => t.costing_matrices[0], "mode" in patch ? { abc_mode: patch.mode } : { abc_total: patch.total }),
    offer: (patch) => setOn((t) => t.costing_matrices[0], "mode" in patch ? { offer_mode: patch.mode } : { offer_total: patch.total }),
  }
  const matrix = shape(tables)
  // Deciding, signing and the people picker go through `writes`: those stay off in a sample.
  const writes = { run: blocked, busy: false, notice: null, refresh: async () => {} }
  return { matrix, save, fall: waterfallSteps(matrix), writes, opportunityId: OPPORTUNITY.id }
}

function Corridor({ variant }) {
  const data = useSampleEvaluation(variant)
  return (
    <CorridorScreen
      data={data}
      opportunity={OPPORTUNITY}
      onOverview={() => toast("The Overview shows the whole sheet with the waterfall. Open an S0 Evaluation in the app to see it.", { id: "sample-overview" })}
      onOpenLine={() => toast("A line opens its parts, costs and Canvass in a side panel in the app.", { id: "sample-line" })}
    />
  )
}

const corridorSample = (variant) =>
  function CorridorSample() {
    return (
      <SampleProvider seed={[[["employees"], EMPLOYEES]]}>
        <SampleAuthProvider user={VIEWER}>
          <div className="min-w-[78rem]">
            <Corridor variant={variant} />
          </div>
        </SampleAuthProvider>
      </SampleProvider>
    )
  }

export const CorridorOffersSample = corridorSample("offers")
export const CorridorFinalAcquireSample = corridorSample("final-acquire")
export const CorridorOtherCostsSample = corridorSample("other-costs")

/* ------------------------------------------------------------------ the Go line, worked like the sheet */

const GO_COSTS = { landed: 200000, expenses: 40000, marketing: 5000 }
const goMatrix = (offer) => ({
  tenderLines: [{ id: "g1", quantity: 1, final_offer_unit: offer, components: [{ tender_line_id: "g1", quantity: 1, final_acquire_unit: GO_COSTS.landed }] }],
  costRows: [{ id: "gr1", quantity: 1, acquire_unit: GO_COSTS.expenses }],
  money: { marketing: GO_COSTS.marketing },
})
const STEP = 10000

export function GoLineDemo() {
  const [offer, setOffer] = useState(430000)
  const s = summary(goMatrix(offer), DEFAULT_COSTING_SETTINGS)
  const pct = s.revenuePercent ?? 0
  const lines = [
    { label: "Final Offer", value: s.finalOfferTotal, how: "what you bid", strong: true },
    { label: "VAT-exclusive", value: s.vatExclusive, how: "the offer ÷ 1.12" },
    { label: "Retention", value: -s.retention, how: "1% of the offer" },
    { label: "Landed Cost (planned)", value: -s.landedCost, how: "the Final Acquire total" },
    { label: "Project expenses", value: -s.projectExpenses, how: "the Other costs added up" },
    { label: "Marketing", value: -s.marketing, how: "as typed" },
    { label: "ITR", value: -s.itr, how: "8% of the offer above ₱250,000" },
  ]
  const max = s.finalOfferTotal || 1
  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-44">
          <Input
            label="Final Offer"
            inputMode="decimal"
            value={String(offer)}
            onChange={(e) => {
              const n = Number(e.target.value.replace(/,/g, ""))
              if (Number.isFinite(n) && n >= 0) setOffer(n)
            }}
          />
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => setOffer((o) => Math.max(0, o - STEP))}>
          <Minus aria-hidden="true" /> ₱10,000
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => setOffer((o) => o + STEP)}>
          <Plus aria-hidden="true" /> ₱10,000
        </Button>
      </div>
      <ul className="space-y-1.5">
        {lines.map((line) => (
          <li key={line.label} className="grid grid-cols-[9.5rem_minmax(0,1fr)_7.5rem] items-center gap-3 text-sm">
            <span className={cn("truncate", line.strong ? "font-semibold" : "text-muted-foreground")}>{line.label}</span>
            <span className="h-2.5 overflow-hidden rounded-full bg-mauve-3" title={line.how}>
              <span
                className={cn("block h-full rounded-full transition-all duration-500 ease-out-expo", line.value < 0 ? "bg-mauve-8" : "bg-mauve-11")}
                style={{ width: `${Math.min(100, (Math.abs(line.value ?? 0) / max) * 100)}%` }}
              />
            </span>
            <span className="text-right font-mono text-[13px] tabular-nums">{pesos(line.value)}</span>
          </li>
        ))}
        <li className="grid grid-cols-[9.5rem_minmax(0,1fr)_7.5rem] items-center gap-3 border-t border-border pt-2 text-sm">
          <span className="font-bold">Revenue</span>
          <span className="h-2.5 overflow-hidden rounded-full bg-mauve-3">
            <span className={cn("block h-full rounded-full transition-all duration-500 ease-out-expo", s.underGoLine ? "bg-amber-9" : "bg-green-9")} style={{ width: `${Math.max(0, Math.min(100, ((s.revenue ?? 0) / max) * 100))}%` }} />
          </span>
          <span className="text-right font-mono text-[13px] font-bold tabular-nums">{pesos(s.revenue)}</span>
        </li>
      </ul>
      <div className="space-y-1.5 rounded-xl border border-border bg-card p-3">
        <div className="flex items-baseline justify-between text-sm">
          <span className="font-semibold">Revenue ÷ Final Offer</span>
          <span className={cn("font-mono font-bold tabular-nums", s.underGoLine ? "text-amber-12" : "text-green-11")}>{pct.toFixed(2)}%</span>
        </div>
        <div className="relative h-3 rounded-full bg-mauve-3">
          <span className={cn("absolute inset-y-0 left-0 rounded-full transition-all duration-500 ease-out-expo", s.underGoLine ? "bg-amber-9" : "bg-green-9")} style={{ width: `${Math.max(0, Math.min(100, (pct / 40) * 100))}%` }} />
          <span className="absolute -inset-y-1 left-1/2 w-0.5 bg-foreground" title="The Go line, 20%" />
        </div>
        <div className="flex justify-between text-[11px] text-muted-foreground">
          <span>0%</span>
          <span>Go line 20%</span>
          <span>40%</span>
        </div>
        <p className="text-sm" aria-live="polite">
          {s.underGoLine ? "Under the Go line. The decision card warns you, but a Go is still allowed." : "At or above the Go line: the bid pays as the sheet expects."}
        </p>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ changes, drawn */

const FLIP_TIMES = [1500, 3200]

/** The Odoo column was Odoo's cost; it is now Odoo's selling price (SRP), and never a cost. */
function OdooSrpScene() {
  const [ref, phase] = useScene(FLIP_TIMES)
  const now = phase >= 1
  return (
    <div ref={ref} aria-hidden="true" className="max-w-xl space-y-3">
      <div className="overflow-hidden rounded-xl border border-border bg-card text-xs">
        <div className="grid grid-cols-[minmax(0,1fr)_8rem_8rem] border-b border-border bg-muted px-3 py-2 text-label font-bold tracking-wider text-muted-foreground uppercase">
          <span>Part</span>
          <span key={String(now)} className="animate-content-in text-right">{now ? "Odoo SRP" : "Odoo"}</span>
          <span className="text-right">Final Acquire</span>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_8rem_8rem] px-3 py-2.5">
          <span>Demo handheld radio</span>
          <span key={`v${now}`} className="animate-content-in text-right font-mono">{now ? "₱15,000.00" : "₱11,000.00"}</span>
          <span className="text-right font-mono">{now ? "₱12,000.00" : "—"}</span>
        </div>
      </div>
      <p key={`n${now}`} className="animate-content-in text-xs text-muted-foreground">
        {now ? "The selling price, pulled from Odoo. Final Acquire is worked from it (SRP less 20%). It is never used as a cost." : "Odoo's cost, used as the cost when nothing else was there."}
      </p>
    </div>
  )
}

const COLUMN_TIMES = [1500, 900, 3000]

/** P.O./RFQ No. and Availability leave; the IPAS that pays for each line arrives as a column. */
function IpasColumnScene() {
  const [ref, phase] = useScene(COLUMN_TIMES)
  const cols = ["Part", "Brand", "Status", "P.O./RFQ No.", "Availability", "IPAS"]
  const shown = (col) => (col === "IPAS" ? phase >= 2 : col === "P.O./RFQ No." || col === "Availability" ? phase === 0 : true)
  return (
    <div ref={ref} aria-hidden="true" className="max-w-2xl overflow-hidden rounded-xl border border-border bg-card text-xs">
      <div className="flex border-b border-border bg-muted px-3 py-2 text-label font-bold tracking-wider text-muted-foreground uppercase">
        {cols.map((col) => (
          <span key={col} className={cn("overflow-hidden whitespace-nowrap transition-all duration-500 ease-out-expo", shown(col) ? "max-w-40 flex-1 opacity-100" : "max-w-0 flex-[0] opacity-0")}>
            {col}
          </span>
        ))}
      </div>
      <div className="flex items-center px-3 py-2.5">
        {["Demo base station", "Demo", "Source Out", "RFQ-0099", "In stock", "IPAS"].map((cell, i) => (
          <span key={cols[i]} className={cn("overflow-hidden whitespace-nowrap transition-all duration-500 ease-out-expo", shown(cols[i]) ? "max-w-40 flex-1 opacity-100" : "max-w-0 flex-[0] opacity-0")}>
            {cell === "IPAS" ? <span className="rounded-full border border-border px-2 py-0.5 font-mono text-[11px] underline">TGIPAS-0001 · open</span> : cell}
          </span>
        ))}
      </div>
    </div>
  )
}

/** Who decides a bid: the decider list or a Super Admin. Everyone else on the Closed Book reads it. */
function DeciderScene() {
  return (
    <div aria-hidden="true" className="grid max-w-2xl gap-3 sm:grid-cols-2">
      <div className="animate-content-in space-y-2.5 rounded-xl border border-border bg-card p-3 text-xs">
        <div className="font-semibold">On the decider list, or a Super Admin</div>
        <div className="h-12 rounded-lg border border-border bg-background p-2 text-muted-foreground">Why this decision…</div>
        <div className="flex gap-1.5">
          <MockButton tone="dark">Go</MockButton>
          <MockButton>Revise</MockButton>
          <MockButton>No-go</MockButton>
        </div>
        <p className="text-muted-foreground">Bid Decisions shows in their menu.</p>
      </div>
      <div className="animate-content-in space-y-2.5 rounded-xl border border-border bg-card p-3 text-xs" style={{ animationDelay: "160ms" }}>
        <div className="font-semibold">Everyone else who reads the figures</div>
        <div className="rounded-lg border border-border bg-muted/50 p-2">Revise at ₱410,000.00 · {PEOPLE.mark.name}</div>
        <p className="font-medium">Only the decider list or a Super Admin decides a bid.</p>
        <p className="text-muted-foreground">No buttons, and no Bid Decisions in the menu.</p>
      </div>
    </div>
  )
}

const SPECS_TIMES = [1300, 1100, 3200]

/** The Specs step leads to the Technical page, and a bulk verdict asks before it overwrites one. */
function SpecsScene() {
  const [ref, phase] = useScene(SPECS_TIMES)
  return (
    <div ref={ref} aria-hidden="true" className="grid max-w-2xl gap-3 sm:grid-cols-2">
      <div className="space-y-2 rounded-xl border border-border bg-card p-3 text-xs">
        <div className="flex items-baseline justify-between">
          <span className="font-semibold">Specs</span>
          <span className="text-muted-foreground">2 of 3 judged</span>
        </div>
        <MockButton tone="dark" pressed={phase === 1}>
          Judge the products <ArrowRight size={12} />
        </MockButton>
        <p className="text-muted-foreground">For the Technical in-charge. Everyone else reads who judges, and where.</p>
      </div>
      <div className={cn("space-y-2 rounded-xl border border-border bg-card p-3 text-xs transition-opacity duration-300", phase >= 2 ? "opacity-100" : "opacity-40")}>
        <div className="font-semibold">Technical page · all 3 checked · Complies</div>
        {phase >= 2 && (
          <div className="modal-enter space-y-2 rounded-lg border border-border bg-background p-2.5 shadow-lg">
            <p>3 are already judged (1 Deviates). Change them too?</p>
            <div className="flex flex-wrap gap-1.5">
              <MockButton>Only the unjudged</MockButton>
              <MockButton tone="dark">All checked</MockButton>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ Before and After: number boxes */

function WheelBefore() {
  const [value, setValue] = useState("13199.89")
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">Click in the box, then turn the mouse wheel over it.</p>
      <Input type="number" step="0.01" aria-label="Acquire / unit, the old box" value={value} onChange={(e) => setValue(e.target.value)} className="w-40 text-right font-mono" />
      <p className="text-xs" aria-live="polite">
        Leaving the box saves <span className="font-mono font-semibold">{value === "" ? "nothing" : value}</span>
        {value !== "13199.89" && <span className="text-red-11"> — a price you never typed.</span>}
      </p>
    </div>
  )
}

function WheelAfter() {
  const [value, setValue] = useState(13199.89)
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">Turn the wheel over it: the page scrolls, the price stays. Commas are fine.</p>
      <div className="w-40">
        <Cell label="Acquire / unit, the new box" noun="Acquire" value={value} numeric money align="right" onSave={async (v) => setValue(v)} />
      </div>
      <p className="text-xs">
        At rest it reads <span className="font-mono font-semibold">{pesos(value)}</span>. Click it to edit the plain number.
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------ Before and After: the Go floor */

const ABC = 500000
const OFFER = 340000
const KNOWN = 200000 // the parts' Final Acquire
const TYPED_OTHERS = 35000 // the Other costs that have an amount
const RATES = DEFAULT_COSTING_SETTINGS

function FloorBar({ floor, label, note }) {
  const lo = 250000
  const hi = 560000
  const at = (v) => `${((v - lo) / (hi - lo)) * 100}%`
  const low = OFFER < floor
  return (
    <div className="space-y-2">
      <div className="relative h-3 rounded-full bg-mauve-3">
        <div className="absolute inset-y-0 bg-jade-5 transition-all duration-700 ease-out-expo" style={{ left: at(floor), width: `calc(${at(ABC)} - ${at(floor)})` }} />
        <div className="absolute -inset-y-1 w-px bg-mauve-11 transition-all duration-700 ease-out-expo" style={{ left: at(floor) }} />
        <div className="absolute -inset-y-1 w-px bg-mauve-11" style={{ left: at(ABC) }} />
        <div className={cn("absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card", low ? "bg-red-9" : "bg-mauve-12")} style={{ left: at(OFFER) }} />
      </div>
      <div className="flex justify-between gap-2 text-[11px]">
        <span>
          <span className="text-muted-foreground">{label} </span>
          <span className="font-mono font-semibold">{pesos(Math.round(floor * 100) / 100)}</span>
        </span>
        <span>
          <span className="text-muted-foreground">Offer </span>
          <span className="font-mono">{pesos(OFFER)}</span>
          <span className="text-muted-foreground"> · ABC </span>
          <span className="font-mono">{pesos(ABC)}</span>
        </span>
      </div>
      {note}
      {low && <p className="text-xs font-medium text-red-11">Below the Go floor: the deal stops paying.</p>}
    </div>
  )
}

const FLOOR_TIMES = [900, 3400]

function FloorBefore() {
  const [ref, phase] = useScene(FLOOR_TIMES)
  // Blank Other costs and Marketing counted as nothing, and the % rows dropped with them.
  const floor = goFloor(phase >= 1 ? KNOWN : KNOWN + TYPED_OTHERS, RATES)
  return (
    <div ref={ref} aria-hidden="true" className="space-y-2">
      <p className="text-xs text-muted-foreground">Two costs are still blank, and the ABC on one line is missing.</p>
      <FloorBar floor={floor} label="Go floor" note={<p className="text-[11px] text-muted-foreground">The floor dropped the typed costs too, so the offer looked safe.</p>} />
    </div>
  )
}

function FloorAfter() {
  const floor = goFloor(KNOWN + TYPED_OTHERS, RATES)
  return (
    <div aria-hidden="true" className="space-y-2">
      <p className="text-xs text-muted-foreground">Two costs are still blank, and the ABC on one line is missing.</p>
      <FloorBar floor={floor} label="Go floor so far" note={<p className="text-[11px] font-medium text-foreground">2 costs not counted yet</p>} />
    </div>
  )
}

/* ------------------------------------------------------------------ Before and After: fits a laptop and a phone */

const SCROLL_TIMES = [1000, 3200]

function Fits({ fixed }) {
  const [ref, phase] = useScene(SCROLL_TIMES)
  const scrolled = phase >= 1
  return (
    <div ref={ref} aria-hidden="true" className="grid grid-cols-[minmax(0,1fr)_6.5rem] gap-3">
      <div className="space-y-1">
        <div className="text-[10px] text-muted-foreground">Laptop, scrolled down</div>
        <div className="relative h-40 overflow-hidden rounded-lg border border-border bg-card">
          <div className={cn("absolute inset-x-0 z-10 border-b border-border bg-card px-2 py-1.5 text-[10px] font-semibold", fixed ? "top-0" : "top-2 shadow")}>The deal · ABC · Offer · Revenue</div>
          {fixed && <div className="absolute inset-x-0 top-7 z-10 border-b border-border bg-muted px-2 py-1 text-[9px] font-bold tracking-wider text-muted-foreground uppercase">Line · ABC · Offer</div>}
          <div className="space-y-2 px-2 pt-14 transition-transform duration-1000 ease-out-expo" style={{ transform: scrolled ? "translateY(-2.5rem)" : "none" }}>
            {!fixed && <div className="text-[9px] font-bold tracking-wider text-muted-foreground uppercase">Line · ABC · Offer</div>}
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="h-3 rounded bg-mauve-4" />
            ))}
          </div>
        </div>
      </div>
      <div className="space-y-1">
        <div className="text-[10px] text-muted-foreground">Phone</div>
        <div className="h-40 overflow-hidden rounded-lg border border-border bg-card p-1.5 text-[9px]">
          {fixed ? (
            <div className="space-y-0.5">
              <div className="font-semibold">The deal</div>
              <div>ABC ₱500,000</div>
              <div>Offer ₱470,000</div>
              <div className="font-semibold">Revenue 32.41%</div>
            </div>
          ) : (
            <div className="w-[12rem] font-semibold whitespace-nowrap">The deal · ABC ₱500,000 · Offer ₱470,000 · Revenue 32.4</div>
          )}
          <Lines n={3} className="mt-2" />
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ the scenes sampleRegistry.js names */

export { OdooSrpScene, IpasColumnScene, DeciderScene, SpecsScene, WheelBefore, WheelAfter, FloorBefore, FloorAfter }
export const FitsBefore = () => <Fits fixed={false} />
export const FitsAfter = () => <Fits fixed />
