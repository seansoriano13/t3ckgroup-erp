import { useState } from "react"
import { Plus, Search, SlidersHorizontal } from "lucide-react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import PageShell from "@/components/ui/PageShell"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { FilterTrigger } from "@/components/ui/FilterDropdown"
import StageFieldPreview from "../flow-canvas/StageFieldPreview"
import OpportunityQuickView from "../sor/OpportunityQuickView"
import OpportunityBoard from "../sor/OpportunityBoard"
import FlowStageControl from "../sor/FlowStageControl"
import MySorsTable from "../sor/MySorsTable"
import SorsViewTabs from "../sor/SorsViewTabs"
import SorsTotals from "../sor/SorsTotals"
import RevertChoice from "../sor/RevertChoice"
import ReturnChoice from "../sor/ReturnChoice"
import { ItemStockRow } from "../sor/modal/ItemsTab"
import { AttentionList, KeyFacts, SectionTitle, StatsBand, StatusLine, TeamAndQuote } from "../sor/modal/summary/DigestSummary"
import { MoneyBars, StageTimeChart } from "../sor/modal/summary/SummaryCharts"
import { useDigest } from "../sor/modal/summary/useDigest"
import { Identity } from "../sor/modal/summary/shared"
import StatusBadge from "../StatusBadge"
import { formatPHP } from "../../constants/sor"
import { CONDITION_STATUS } from "../../constants/stageGate"
import { REVERT_CHOICE } from "../../constants/revertChoice"
import { RETURN_CHOICE } from "../../constants/returnChoice"
import SampleProvider from "./SampleProvider"
import {
  PEOPLE,
  SALE_TYPE_ID,
  SAMPLE_ACTOR,
  SAMPLE_BOARD_OPPORTUNITIES,
  SAMPLE_CANVAS,
  SAMPLE_FLOW_STAGES_INDEX,
  SAMPLE_LINES,
  SAMPLE_OPPORTUNITY,
  SAMPLE_SALE_TYPE,
  SAMPLE_STAGES,
  STOCK_SNAPSHOT,
  daysAgo,
  inDays,
} from "./sampleData"

/**
 * The SOR screens, as the app's own components fed Sample Data (ADR 0030).
 * Each sits in a SampleProvider, so what it reads is seeded and anything it
 * would save is refused.
 */

const noop = () => {}
const SEED_CANVAS = [["salesFlow", SALE_TYPE_ID], SAMPLE_CANVAS]

function OpenButton({ label, children }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="space-y-3">
      <Button type="button" onClick={() => setOpen(true)}>
        {label}
      </Button>
      {children(open, () => setOpen(false))}
    </div>
  )
}

/* ── SOR Register ───────────────────────────────────────────────────────── */

const REGISTER_ROWS = [
  { id: "r1", ref: "S00001", client: "Demo Clinic", owner: PEOPLE.lara.name, stage: "Lead", value: 500000 },
  { id: "r2", ref: "S00002", client: "Demo City Hospital", owner: PEOPLE.lara.name, stage: "Bid Submitted", value: 1000000 },
  { id: "r3", ref: "S00003", client: "Demo Province", owner: PEOPLE.mark.name, stage: "Bid Submitted", value: 3000000 },
  { id: "r4", ref: "S00005", client: "Demo Town Hall", owner: PEOPLE.paolo.name, stage: "Awarded", value: 2000000 },
]

export function SorRegisterSample() {
  const [view, setView] = useState("list")
  const [search, setSearch] = useState("")
  const needle = search.trim().toLowerCase()
  const rows = REGISTER_ROWS.filter((r) => !needle || `${r.ref} ${r.client} ${r.owner}`.toLowerCase().includes(needle))

  return (
    <PageShell
      className="!px-0 !pb-0"
      title="SOR Register"
      action={
        <>
          <SorsViewTabs view={view} onChange={setView} />
          <Button type="button" onClick={noop}>
            <Plus size={16} strokeWidth={2.5} />
            Register SOR
          </Button>
        </>
      }
      toolbar={
        <div className="flex w-full min-w-0 items-center gap-2 sm:gap-3">
          <div className="flex h-9 min-w-[7rem] max-w-[360px] flex-1 items-center gap-2 rounded-xl border border-border bg-muted/30 px-2.5 sm:px-3">
            <Search size={15} className="shrink-0 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search number, client, project, deal owner…"
              containerClassName="w-full"
              className="h-auto rounded-none border-0 bg-transparent px-0 py-0 text-sm font-medium shadow-none focus-visible:ring-0"
            />
          </div>
          <SorsTotals className="hidden lg:flex" count={rows.length} openValue={4500000} wonValue={2000000} />
          <div className="flex-1" />
          <FilterTrigger className="h-9 w-auto gap-2 px-3" icon={SlidersHorizontal} label="Filters" count={0} isActive={false} />
        </div>
      }
    >
      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Sales Ref.</TableHead>
              <TableHead>Company</TableHead>
              <TableHead>Deal Owner</TableHead>
              <TableHead>Stage</TableHead>
              <TableHead className="text-right">Expected value</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono text-xs font-bold text-foreground">{r.ref}</TableCell>
                <TableCell className="font-medium text-foreground">{r.client}</TableCell>
                <TableCell className="text-muted-foreground">{r.owner}</TableCell>
                <TableCell>
                  <StatusBadge label={r.stage} theme="blue" />
                </TableCell>
                <TableCell className="text-right font-bold tabular-nums text-foreground">{formatPHP(r.value)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </PageShell>
  )
}

/* ── Board ──────────────────────────────────────────────────────────────── */

export function BoardSample() {
  return (
    <SampleProvider
      seed={[
        [["pipelineStages", "active"], []],
        [["pipelineStages", "all"], []],
      ]}
    >
      <div className="h-[420px] min-w-[720px]">
        <OpportunityBoard
          opportunities={SAMPLE_BOARD_OPPORTUNITIES}
          search=""
          flowStagesIndex={SAMPLE_FLOW_STAGES_INDEX}
          snapshotsById={{}}
          saleTypes={[SAMPLE_SALE_TYPE]}
          stages={[]}
          onCardClick={noop}
          onMoved={noop}
          currentUserId={null}
          saleTypeFilter={SALE_TYPE_ID}
          onSaleTypeChange={noop}
          onSwitchToList={noop}
        />
      </div>
    </SampleProvider>
  )
}

/* ── SOR window: Summary ────────────────────────────────────────────────── */

const SUMMARY_ITEMS = SAMPLE_LINES.map((line, i) => ({ ...line, id: `line-${i}`, sort_order: i }))
const CURRENT_VISIT = { id: "visit-bid", enteredAt: daysAgo(6), leftAt: null }
const VISITS = [
  { id: "v1", stage: SAMPLE_STAGES[0], enteredAt: daysAgo(20), leftAt: daysAgo(15) },
  { id: "v2", stage: SAMPLE_STAGES[1], enteredAt: daysAgo(15), leftAt: daysAgo(6) },
  { id: "v3", stage: SAMPLE_STAGES[2], enteredAt: daysAgo(6), leftAt: null },
]

const SUMMARY_P = {
  id: SAMPLE_OPPORTUNITY.id,
  opportunity: SAMPLE_OPPORTUNITY,
  ctx: {
    automationTasks: {
      groupTasks: [
        {
          id: "gt1",
          title: "Bid documents",
          due_date: inDays(3),
          stage_visit_id: CURRENT_VISIT.id,
          members: [
            { id: "m1", employee: PEOPLE.lara, status: "DONE" },
            { id: "m2", employee: PEOPLE.joy, status: "PENDING" },
          ],
        },
      ],
      individualTasks: [],
    },
    items: SUMMARY_ITEMS,
    itemsLoading: false,
    estimatedValueDisplay: formatPHP(1000000),
    accessLevel: "full",
    activeLeadSources: [],
    isEditing: false,
    pendingStage: null,
    stageLabel: (s) => s,
    buildingLink: false,
    downloadStep: null,
    handlePreviewQuotation: noop,
    handleCopyQuotationLink: noop,
    handleDownloadQuotation: noop,
  },
  notes: [
    { id: "n1", type: "COMMENT", author: PEOPLE.lara, content: "Pre-bid conference is on Friday. I'll attend for the team.", created_at: daysAgo(2) },
  ],
  checklist: [
    { status: CONDITION_STATUS.UNSATISFIED, condition: { id: "c1", label: "Bid security attached", is_required: true } },
    { status: CONDITION_STATUS.SATISFIED, condition: { id: "c2", label: "Technical documents checked", is_required: true } },
  ],
  stageMutation: { isPending: false, mutate: noop },
  isFlowDeal: true,
  flowCanvas: SAMPLE_CANVAS,
  currentFlowStage: SAMPLE_STAGES[2],
  currentFlowStageTone: "blue",
  returnStageIds: [],
  moveDisabled: false,
  isRestricted: false,
  canViewJourney: true,
}

function SummaryBody({ p }) {
  const dg = useDigest(p)
  return (
    <div className="space-y-6">
      <Identity p={p} />
      <StatusLine p={p} dg={dg} />
      <StatsBand p={p} dg={dg} />
      <div className="grid gap-6 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-7">
          <AttentionList dg={dg} go={noop} />
          <section>
            <SectionTitle aside={<span className="text-xs font-semibold tabular-nums text-muted-foreground">{dg.itemsTotal}</span>}>
              Where the money is
            </SectionTitle>
            <div className="rounded-xl border border-border/70 bg-card p-5">
              <MoneyBars p={p} onOpen={noop} />
            </div>
          </section>
        </div>
        <div className="space-y-6 lg:col-span-5">
          <section>
            <SectionTitle>Time in each stage</SectionTitle>
            <div className="rounded-xl border border-border/70 bg-card p-5">
              <StageTimeChart p={p} visits={VISITS} onOpen={noop} />
            </div>
          </section>
          <div className="rounded-xl border border-border/70 bg-card p-5">
            <TeamAndQuote p={p} />
          </div>
          <div className="rounded-xl border border-border/70 bg-card p-5">
            <KeyFacts p={p} />
          </div>
        </div>
      </div>
    </div>
  )
}

export function SorSummarySample() {
  return (
    <SampleProvider
      seed={[
        [["currentStageVisit", SAMPLE_OPPORTUNITY.id, SAMPLE_OPPORTUNITY.flow_stage_id], CURRENT_VISIT],
        [["followUpStatus", SAMPLE_OPPORTUNITY.id, SAMPLE_OPPORTUNITY.flow_stage_id], { nextDue: inDays(2) }],
      ]}
    >
      <div className="min-w-[640px] rounded-2xl border border-border bg-background p-6">
        <SummaryBody p={SUMMARY_P} />
      </div>
    </SampleProvider>
  )
}

/* ── Revert, then Resume or Start fresh ─────────────────────────────────── */

export function RevertResumeSample() {
  const [revert, setRevert] = useState(REVERT_CHOICE.KEEP)
  const [ret, setRet] = useState(RETURN_CHOICE.RESUME)
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="space-y-3 rounded-2xl border border-border bg-card p-5">
        <p className="text-sm font-bold text-foreground">Revert out of Bid Submitted?</p>
        <RevertChoice stageName="Bid Submitted" value={revert} onChange={setRevert} />
      </div>
      <div className="space-y-3 rounded-2xl border border-border bg-card p-5">
        <p className="text-sm font-bold text-foreground">Move back to Technical Review?</p>
        <ReturnChoice stageName="Technical Review" value={ret} onChange={setRet} />
      </div>
    </div>
  )
}

/* ── Quick View ─────────────────────────────────────────────────────────── */

const QUICK_TASKS = [
  {
    id: "t1",
    kind: "individual",
    title: "Prepare the technical compliance sheet",
    taskDescription: "Match every line of the terms of reference to what we offer.",
    dueAt: inDays(3),
    priority: "HIGH",
  },
  {
    id: "g1",
    kind: "group",
    title: "Bid documents",
    taskDescription: "Put together and submit the bid documents.",
    dueAt: inDays(5),
    checklistProgress: { checked: 1, total: 3 },
  },
]

const QUICK_CHECKLIST = [
  { status: CONDITION_STATUS.UNSATISFIED, condition: { id: "c1", label: "Bid security attached" } },
  { status: CONDITION_STATUS.UNSATISFIED, condition: { id: "c2", label: "Bid deadline filled in" } },
  { status: CONDITION_STATUS.SATISFIED, condition: { id: "c3", label: "Client company confirmed" } },
]

export function QuickViewSample() {
  return (
    <SampleProvider
      seed={[
        [["quickViewTasks", SAMPLE_OPPORTUNITY.id, SAMPLE_ACTOR], QUICK_TASKS],
        [["quickViewChecklist", SAMPLE_OPPORTUNITY.id, SAMPLE_OPPORTUNITY.flow_stage_id, SAMPLE_OPPORTUNITY.flow_snapshot_id ?? null], QUICK_CHECKLIST],
      ]}
    >
      <OpenButton label="Open Quick View">
        {(open, close) => (
          <OpportunityQuickView
            isOpen={open}
            onClose={close}
            opportunity={SAMPLE_OPPORTUNITY}
            opportunityId={SAMPLE_OPPORTUNITY.id}
            userId={SAMPLE_ACTOR}
            onViewFullDetails={close}
            onOpenTask={close}
            onOpenGroupTask={close}
          />
        )}
      </OpenButton>
    </SampleProvider>
  )
}

/* ── My SORs ────────────────────────────────────────────────────────────── */

const MY_SORS = [
  {
    opportunityId: "my-1",
    salesReference: "S00002",
    projectTitle: "Demo: 10 hospital beds",
    currentStageName: "Bid Submitted",
    isOpen: true,
    windows: [
      { id: "w1", calledInAtStageName: "Technical Review", source: "action", reachLabel: "the rest of the SOR", closedAt: null, createdAt: daysAgo(9) },
    ],
  },
  {
    opportunityId: "my-2",
    salesReference: "S00003",
    projectTitle: "Demo: rescue equipment",
    currentStageName: "Technical Review",
    isOpen: true,
    windows: [
      { id: "w2", calledInAtStageName: "Technical Review", source: "assignment", reachLabel: "this Stage only", closedAt: null, createdAt: daysAgo(4) },
      { id: "w3", calledInAtStageName: "Lead", source: "purchase_request", reachLabel: "this Stage only", closedAt: daysAgo(6), createdAt: daysAgo(12) },
    ],
  },
]

export function MySorsSample() {
  return <MySorsTable rows={MY_SORS} onOpen={noop} />
}

/* ── Move button says why it is blocked ─────────────────────────────────── */

export function BlockedMoveSample() {
  return (
    <SampleProvider seed={[SEED_CANVAS]}>
      <div className="max-w-3xl space-y-6">
        <div className="space-y-2">
          <p className="text-[13px] font-semibold text-muted-foreground">A required field and a checklist item are still open</p>
          <FlowStageControl opportunity={SAMPLE_OPPORTUNITY} onMove={noop} isMoving={false} blockedBy={["Bid deadline", "Bid security attached"]} />
        </div>
        <div className="space-y-2">
          <p className="text-[13px] font-semibold text-muted-foreground">Everything answered</p>
          <FlowStageControl opportunity={SAMPLE_OPPORTUNITY} onMove={noop} isMoving={false} blockedBy={[]} />
        </div>
      </div>
    </SampleProvider>
  )
}

/* ── Open and Won, ITB Number ───────────────────────────────────────────── */

export function OpenWonSample() {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3">
        <SorsTotals count={5} openValue={4500000} wonValue={2000000} />
      </div>
      <div className="max-w-sm">
        <StageFieldPreview
          draft={{
            label: "ITB Number",
            source: "custom",
            isRequired: false,
            help: "Asked for only on the Stages that need it.",
            fieldType: "text",
            options: [],
          }}
        />
      </div>
    </div>
  )
}

/* ── Stock on the Product List ──────────────────────────────────────────── */

export function StockSample() {
  return (
    <div className="grid max-w-2xl grid-cols-12 gap-x-3 gap-y-3 rounded-2xl border border-border bg-card p-4">
      {SAMPLE_LINES.map((line, i) => (
        <div key={line.product_name} className="col-span-12 space-y-1">
          <div className="flex justify-between text-[14px] font-medium text-foreground">
            <span>{line.product_name}</span>
            <span className="text-muted-foreground">×{line.quantity}</span>
          </div>
          <div className="grid grid-cols-12">
            <ItemStockRow item={{ ...line, id: `stock-${i}` }} snapshotData={STOCK_SNAPSHOT} />
          </div>
        </div>
      ))}
    </div>
  )
}
