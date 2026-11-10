import toast from "react-hot-toast"
import { SampleAuthProvider } from "@/context/AuthContext"
import BidDecisionPanel from "../costing/BidDecisionPanel"
import IpasPaymentsTable from "../ipas/IpasPaymentsTable"
import IpasSorSection from "../ipas/IpasSorSection"
import { ipasSorSummariesKey } from "../ipas/ipasKeys"
import { COSTING_TIER } from "../../constants/costing"
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
  summary: { revenue: 210000, operationalExpenses: 1080000, itr: 60000 },
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
