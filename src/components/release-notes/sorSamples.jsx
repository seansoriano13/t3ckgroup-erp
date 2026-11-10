import { useState } from "react"
import toast from "react-hot-toast"
import { Button } from "@/components/ui/button"
import MySorsTable from "../sor/MySorsTable"
import MarkLostDialog from "../sor/MarkLostDialog"
import S0Card from "../sor/S0Card"
import SystemNoteChanges from "../sor/modal/SystemNoteChanges"
import { AttentionList } from "../sor/modal/summary/DigestSummary"
import SampleProvider, { SAMPLE_SAVE_BLOCKED } from "./SampleProvider"
import { PEOPLE, daysAgo, hoursAgo, inDays } from "./sampleData"

/**
 * The SORs tab's samples: the app's own components fed Sample Data.
 * Throwaway (ADR 0030, 2026-11 amendment): if one breaks, delete it.
 */

const noop = () => {}
const blocked = () => toast(SAMPLE_SAVE_BLOCKED, { id: "sample-save-blocked" })

const move = (id, kind, label, sinceDays, dueInDays) => ({
  id,
  entityType: "TASK",
  kind,
  label,
  since: daysAgo(sinceDays),
  dueAt: dueInDays == null ? null : inDays(dueInDays),
})

const MY_WORK_ROWS = [
  {
    opportunityId: "sample-work-1",
    salesReference: "S00412",
    projectTitle: "Demo Province Radio Network",
    currentStageName: "Technical Review",
    currentStageColor: "blue",
    isOpen: true,
    windows: [],
    moves: [move("t1", "Task", "Upload the signed site survey", 6, -1), move("t2", "Group Task", "Bid documents checklist", 3, 4)],
  },
  {
    opportunityId: "sample-work-2",
    salesReference: "S00398",
    projectTitle: "Demo City Hall CCTV",
    currentStageName: "Costing",
    currentStageColor: "amber",
    isOpen: true,
    windows: [],
    moves: [{ ...move("pr1", "Purchase Request", "Buy for Demo City Hall CCTV", 2, null), entityType: "PURCHASE_REQUEST" }],
  },
  {
    opportunityId: "sample-work-3",
    salesReference: "S00377",
    projectTitle: "Demo School Laptops",
    currentStageName: "Bid Submitted",
    currentStageColor: "violet",
    isOpen: true,
    windows: [
      {
        id: "w1",
        source: "mention",
        mentionedBy: PEOPLE.lara.name,
        calledInAtStageName: "Bid Submitted",
        closedAt: null,
        createdAt: daysAgo(5),
        reachLabel: "this SOR, read-only",
      },
    ],
    moves: [],
  },
]

export function MyWorkSample() {
  return <MySorsTable rows={MY_WORK_ROWS} onOpen={noop} />
}

export function MarkLostSample() {
  const [open, setOpen] = useState(false)
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Demo School Laptops · S00377 · Bid Submitted</p>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        Mark as Lost
      </Button>
      <MarkLostDialog
        isOpen={open}
        onCancel={() => setOpen(false)}
        onConfirm={() => {
          setOpen(false)
          blocked()
        }}
      />
    </div>
  )
}

const S0_CARD = {
  sales_reference: "S00412",
  odoo_state: "found",
  checked_at: hoursAgo(2),
  product_count: 6,
  lock: "locked",
  first_stage_name: "Lead",
  can_edit: true,
  duplicates: [],
}

export function S0CardSample() {
  return (
    <SampleProvider seed={[[["salesReferenceCard", "sample-s0"], S0_CARD]]}>
      <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
        SOR-0412 · Demo Province Radio Network
        <S0Card opportunityId="sample-s0" />
      </p>
    </SampleProvider>
  )
}

const ATTENTION = {
  attention: [
    { key: "pr", tone: "amber", text: "Open Purchase Request is waiting for your Create or Skip.", go: "now" },
    { key: "b-docs", tone: "amber", text: "Before moving: Signed site survey", go: "now" },
    { key: "overdue", tone: "red", text: "1 task is past due.", go: "now" },
  ],
}

export function NeedsAttentionSample() {
  return (
    <div className="max-w-xl">
      <AttentionList dg={ATTENTION} go={noop} />
    </div>
  )
}

const CHANGE_NOTE = {
  changes: [
    "Expected Value changed from ₱1,000,000 to ₱1,200,000",
    'Target Close Date changed from "Nov 28, 2026" to "Dec 12, 2026"',
    "Added product(s): Demo Rugged Laptop 14",
  ],
  productChanges: [
    { type: "added", name: "Demo Rugged Laptop 14" },
    { type: "added", name: "Demo Laptop Bag" },
    { type: "renamed", from: "Demo Radio X1", name: "Demo Radio X1 Pro" },
    { type: "removed", name: "Demo Docking Station" },
  ],
}

export function ChangeNotesSample() {
  return (
    <div className="max-w-xl rounded-xl border border-border bg-card p-4">
      <p className="mb-2 text-xs font-semibold text-muted-foreground">System · {PEOPLE.paolo.name} saved the SOR</p>
      <SystemNoteChanges metadata={CHANGE_NOTE} />
    </div>
  )
}
