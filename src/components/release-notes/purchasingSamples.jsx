import toast from "react-hot-toast"
import { SampleAuthProvider } from "@/context/AuthContext"
import BidDecisionPanel from "../costing/BidDecisionPanel"
import IpasPaymentsTable from "../ipas/IpasPaymentsTable"
import IpasSorSection from "../ipas/IpasSorSection"
import { ipasSorSummariesKey } from "../ipas/ipasKeys"
import { COSTING_TIER } from "../../constants/costing"
import CanvassGrid from "../purchase-request/CanvassGrid"
import { canvassKeys, purchaseRequestKeys } from "../purchase-request/queryKeys"
import SampleProvider, { SAMPLE_SAVE_BLOCKED } from "./SampleProvider"
import { PEOPLE, isoDate } from "./sampleData"

/**
 * The Purchasing (Beta) tab's samples: the app's own components fed Sample
 * Data. A sample here passes its own `writes`, so a decision never reaches
 * the service the real screen calls.
 * Throwaway (ADR 0030, 2026-11 amendment): if one breaks, delete it.
 */

const blocked = () => toast(SAMPLE_SAVE_BLOCKED, { id: "sample-save-blocked" })

// What a real screen passes to save; here every save stops at the toast.
const WRITES = { run: blocked, busy: false, notice: null }

// Signed in as a made-up salesperson, so no screen here is the viewer's own.
const VIEWER = { id: "sample-viewer", name: "Sample Viewer", department: "SALES" }

const BID_MATRIX = {
  matrixId: "sample-matrix",
  tier: COSTING_TIER.CLOSED_BOOK,
  bidDecision: null,
  bidDecisionHistory: [],
  canDecideLoss: true,
  evaluation: { approved: true },
  tenderLines: [
    { id: "tl-1", number: "1", tender_specification: "Demo rugged handheld radio", quantity: 20, abc_unit: 50000, final_offer_unit: 45000 },
    { id: "tl-2", number: "2", tender_specification: "Demo radio base station", quantity: 2, abc_unit: 250000, final_offer_unit: 225000 },
  ],
  totals: { missingOffer: 0, finalOfferTotal: 1350000, abcTotal: 1500000 },
  summary: { revenue: 210000, landedCost: 1080000, itr: 60000 },
}

export function BidDecisionSample() {
  return (
    <div className="max-w-2xl">
      <BidDecisionPanel matrix={BID_MATRIX} writes={WRITES} nameOf={() => PEOPLE.mark.name} />
    </div>
  )
}

const payment = (id, kind, daysFromToday, amount, rate, method, extra = {}) => ({
  id,
  kind,
  paid_on: isoDate(daysFromToday),
  methodLabel: method,
  amount,
  forex_rate: rate,
  rate,
  check_no: null,
  charge_fee_php: 0,
  bank_charge_php: 0,
  doc_stamp_php: 0,
  misc_fee_php: 0,
  proof_url: null,
  paid_before_approval: false,
  ...extra,
})

const IPAS = {
  currency: "USD",
  payments: [
    payment("pay-1", "down_payment", -20, 3000, 58.4, "Telegraphic transfer", { bank_charge_php: 1500 }),
    payment("pay-2", "full_payment", -4, 7000, 58.9, "Telegraphic transfer", { bank_charge_php: 1500, doc_stamp_php: 300 }),
    payment("pay-3", "shipping_fee", -2, 450, 58.9, "Check", { check_no: "000123" }),
  ],
}

export function IpasPaymentsSample() {
  return <IpasPaymentsTable ipas={IPAS} />
}

const SUMMARIES = [
  {
    id: "sample-ipas-1",
    number: "TGIPAS-0001",
    state: "open",
    poNumber: "P00001",
    supplier: "Demo Radio Supplies Co.",
    purpose: "project",
    nextThing: "Delivered — waiting on the supplier",
    nextList: null,
    owner: "purchasing",
    daysWaiting: 6,
    late: true,
    trackDone: 3,
    trackTotal: 6,
    buyerTrack: [
      { key: "purchase_order", label: "Purchase Order", ticked: true },
      { key: "with_pop", label: "With P.O.P", ticked: true },
      { key: "import_clearance", label: "Import Clearance", ticked: true },
      { key: "delivered", label: "Delivered", partial: true },
      { key: "actual_checking", label: "Actual Checking" },
      { key: "create_bill", label: "Create Bill" },
    ],
    computationLabel: "Encoded",
    landedCost: null,
    signoffs: [
      { section: 1, name: "Order", steps: [{ label: "Submitted", done: true }, { label: "Approved", done: true }] },
      { section: 3, name: "Payments", steps: [{ label: "Submitted", done: true }, { label: "Approved", done: false }] },
    ],
  },
]

export function PmsIpasSample() {
  return (
    <SampleProvider seed={[[ipasSorSummariesKey("sample-pms-sor"), SUMMARIES]]}>
      <SampleAuthProvider user={VIEWER}>
        <IpasSorSection opportunityId="sample-pms-sor" />
      </SampleAuthProvider>
    </SampleProvider>
  )
}

// The request’s Canvass (ADR 0053): two lines down, three suppliers across, one with a winner.
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
