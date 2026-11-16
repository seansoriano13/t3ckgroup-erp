import { useState } from "react"
import { ExternalLink, Lock, X } from "lucide-react"
import { SampleAuthProvider } from "@/context/AuthContext"
import { Button } from "@/components/ui/button"
import BetaTag from "@/components/ui/BetaTag"
import { cn } from "@/lib/utils"
import CanvassGrid from "../purchase-request/CanvassGrid"
import { canvassKeys, purchaseRequestKeys } from "../purchase-request/queryKeys"
import StatusBadge from "../StatusBadge"
import SampleProvider from "./SampleProvider"
import { Lines, MockWindow } from "./motion"
import { useScene } from "./useScene"
import { isoDate } from "./sampleData"

/**
 * The Purchasing (Beta) tab: the request's Canvass grid (the real component fed Sample Data), the
 * PMS file on its own page, and drawn scenes of the Canvasses page and the printed Canvass.
 * Throwaway (ADR 0030, 2026-11 amendment): if one breaks, delete it.
 */

// Signed in as a made-up salesperson, so no screen here is the viewer's own.
const VIEWER = { id: "sample-viewer", name: "Sample Viewer", department: "SALES" }

/* ------------------------------------------------------------------ the Canvass grid */

// The request's Canvass (ADR 0053): two lines down, three suppliers across, one with a winner.
// The viewer is on the Sales side, so the grid is the plain read of it, with no edit controls.
const CANVASS_REQUEST = { id: "sample-canvass-request", title: "Demo rescue gear", opportunity_id: null }
const CANVASS_ITEMS = [
  { id: "ci-1", request_id: CANVASS_REQUEST.id, name: "Demo folding stretcher", quantity: 4, unit: "pc", status: "still_canvassing" },
  { id: "ci-2", request_id: CANVASS_REQUEST.id, name: "Demo spine board", quantity: 2, unit: "pc", status: "still_canvassing" },
]
const supplier = (id, order, name, extra = {}) => ({
  id, canvass_id: "sample-canvass", sort_order: order, supplier_name: name, currency: "PHP", lead_time: "14 days", quality_note: null, valid_until: null, expired: false, comparison_rate: null, ...extra,
})
const quote = (supplierId, itemId, unit, figure = unit, extra = {}) => ({
  id: `sq-${supplierId}-${itemId}`, canvass_id: "sample-canvass", supplier_id: supplierId, item_id: itemId, brand: null, description: null, source_link: null, remarks: null, brochure: [], unit_price: unit, php_figure: figure, ...extra,
})
const CANVASS = {
  id: "sample-canvass",
  number: "CNV_0001",
  request_id: CANVASS_REQUEST.id,
  canReadMoney: true,
  suppliers: [
    supplier("sup-1", 0, "Demo Rescue Supply Co."),
    supplier("sup-2", 1, "Demo Medical Traders", { lead_time: "10 days" }),
    supplier("sup-3", 2, "Demo Hong Kong Ltd.", { currency: "USD", comparison_rate: 56.5, lead_time: "45 days", quality_note: "Grade A" }),
  ],
  quotes: [
    quote("sup-1", "ci-1", 18000, 18000, { brand: "Demo" }),
    quote("sup-2", "ci-1", 17500, 17500),
    quote("sup-3", "ci-1", 300, 16950),
    quote("sup-1", "ci-2", 9000),
    quote("sup-2", "ci-2", 9500),
  ],
  winners: [{ item_id: "ci-1", supplier_id: "sup-3", reason: "Lowest in PHP and Grade A.", chosen_at: isoDate(-1) }],
  noOtherSupplier: null,
}

export function CanvassGridSample() {
  return (
    <SampleProvider
      seed={[
        [purchaseRequestKeys.items(CANVASS_REQUEST.id), CANVASS_ITEMS],
        [purchaseRequestKeys.itemActor(CANVASS_REQUEST.id), { side: "sales", canSubstitute: false }],
        [canvassKeys.request(CANVASS_REQUEST.id), CANVASS],
      ]}
    >
      <SampleAuthProvider user={VIEWER}>
        <CanvassGrid request={CANVASS_REQUEST} />
      </SampleAuthProvider>
    </SampleProvider>
  )
}

/* ------------------------------------------------------------------ the PMS file on its own page */

const PMS_SECTIONS = [
  ["S0 Evaluation", "Go · locked"],
  ["Purchase Request", "Demo radio network · 3 lines"],
  ["IPAS", "TGIPAS-0001 · open"],
  ["Transmittals", "TG03-0007 · waiting for Check by"],
  ["Packing Lists", "1 box packed"],
]

export function PmsPageDemo() {
  const [own, setOwn] = useState(false)
  const address = own ? "t3ckgroup-erp.online/purchasing/pms/SOR-0412" : "t3ckgroup-erp.online/sors?open=sor:SOR-0412&view=pms"
  return (
    <div className="max-w-2xl space-y-3">
      <MockWindow address={address}>
        <div className={cn("space-y-3 transition-all duration-300", !own && "rounded-xl border border-border p-3 shadow-sm")}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="font-mono text-[11px] text-muted-foreground">SOR-0412 · S01234</div>
              <div className="flex items-center gap-2 text-sm font-semibold">
                {own ? "PMS file" : "Demo radio network"}
                <BetaTag />
              </div>
            </div>
            {own ? (
              <Button type="button" variant="outline" size="sm" onClick={() => setOwn(false)}>
                Open SOR
              </Button>
            ) : (
              <Button type="button" variant="link" size="sm" onClick={() => setOwn(true)}>
                Open on its own page <ExternalLink aria-hidden="true" />
              </Button>
            )}
          </div>
          {!own && (
            <div className="flex gap-3 border-b border-border text-xs text-muted-foreground" aria-hidden="true">
              <span className="pb-1.5">Summary</span>
              <span className="pb-1.5">Products</span>
              <span className="border-b-2 border-mauve-10 pb-1.5 font-semibold text-foreground">PMS</span>
              <span className="pb-1.5">History</span>
            </div>
          )}
          <ul key={String(own)} className="grid gap-2 sm:grid-cols-2">
            {PMS_SECTIONS.map(([name, line], i) => (
              <li key={name} className="animate-content-in rounded-lg border border-border bg-card px-3 py-2 text-xs" style={{ animationDelay: `${i * 60}ms` }}>
                <div className="font-semibold">{name}</div>
                <div className="text-muted-foreground">{line}</div>
              </li>
            ))}
          </ul>
        </div>
      </MockWindow>
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {own ? "The same sections, on a page of their own. Open SOR goes back to the SOR on its PMS tab." : "Inside the SOR window. Press Open on its own page."}
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------ the Canvasses page, one row per request */

const LIST = [
  { number: "CNV_0003", request: "Demo rescue gear", project: "SOR-0412", suppliers: 1, won: "0 of 2", status: "Needs suppliers", theme: "amber" },
  { number: "CNV_0002", request: "Demo office radios", project: "Direct request", suppliers: 3, won: "1 of 4", status: "Needs winners", theme: "blue" },
  { number: "CNV_0001", request: "Demo base stations", project: "SOR-0398", suppliers: 3, won: "3 of 3", status: "Winners picked", theme: "green", locked: true },
]
const ROW_TIMES = [500, 500, 500, 3200]
const LIST_COLS = "grid grid-cols-[5.5rem_minmax(0,1fr)_6.5rem_4.5rem_4.5rem_9rem] gap-2"

function CanvassesPageScene() {
  const [ref, phase] = useScene(ROW_TIMES)
  return (
    <div ref={ref} aria-hidden="true" className="min-w-[40rem] max-w-3xl overflow-hidden rounded-xl border border-border bg-card text-xs">
      <div className={cn(LIST_COLS, "border-b border-border bg-muted px-3 py-2 text-label font-bold tracking-wider text-muted-foreground uppercase")}>
        <span>Canvass</span>
        <span>Request</span>
        <span>Project</span>
        <span>Suppliers</span>
        <span>Winners</span>
        <span>Status</span>
      </div>
      {LIST.map((row, i) => (
        <div
          key={row.number}
          className={cn(LIST_COLS, "items-center border-b border-border px-3 py-2.5 transition-all duration-500 ease-out-expo last:border-b-0", phase > i ? "opacity-100" : "translate-y-1 opacity-0")}
        >
          <span className="font-mono">{row.number}</span>
          <span className="truncate">{row.request}</span>
          <span className="truncate text-muted-foreground">{row.project}</span>
          <span className="font-mono">{row.suppliers} of 3</span>
          <span className="font-mono">{row.won}</span>
          <span className="flex items-center gap-1.5">
            <StatusBadge label={row.status} theme={row.theme} />
            {row.locked && <Lock size={12} className="text-muted-foreground" />}
          </span>
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ the printed Canvass, three suppliers to a page */

const PRINT_TIMES = [1400, 3200]
const PRINT_LINES = ["1 · Radio", "2 · Antenna", "3 · Cable"]

function PrintPage({ suppliers, n, of }) {
  return (
    <div className="w-56 shrink-0 space-y-2 rounded-md border border-border bg-background p-2.5 text-[9px] shadow-sm">
      <div className="flex justify-between font-semibold">
        <span>CANVASS · CNV_0002</span>
        <span className="text-muted-foreground">
          Page {n} of {of}
        </span>
      </div>
      <div className="grid gap-1" style={{ gridTemplateColumns: `4.5rem repeat(${suppliers.length}, minmax(0,1fr))` }}>
        <span className="font-semibold">Line</span>
        {suppliers.map((s) => (
          <span key={s} className="truncate font-semibold">{s}</span>
        ))}
        {PRINT_LINES.map((line, li) => (
          <div key={line} className="contents">
            <span className="truncate">{line}</span>
            {suppliers.map((s, si) => (
              <span key={s} className={cn("rounded px-0.5", li === si && "bg-green-a3 font-semibold")}>
                {li === 2 && si === 1 ? "no quote" : "₱ ·····"}
              </span>
            ))}
          </div>
        ))}
      </div>
      <Lines n={2} />
      <div className="pt-1 text-muted-foreground">Canvassed by ______</div>
    </div>
  )
}

function CanvassPrintScene() {
  const [ref, phase] = useScene(PRINT_TIMES)
  return (
    <div ref={ref} aria-hidden="true" className="flex max-w-3xl gap-3 overflow-x-auto pb-1">
      <PrintPage suppliers={["Supplier A", "Supplier B", "Supplier C"]} n={1} of={phase >= 1 ? 2 : 1} />
      {phase >= 1 ? (
        <div className="animate-content-in">
          <PrintPage suppliers={["Supplier D", "Supplier E"]} n={2} of={2} />
        </div>
      ) : (
        <div className="flex w-40 items-center text-xs text-muted-foreground">
          <X size={14} className="mr-1" /> And a fourth supplier?
        </div>
      )}
    </div>
  )
}

export { CanvassesPageScene, CanvassPrintScene }
