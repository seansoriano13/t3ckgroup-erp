import { useState } from "react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import StageFieldPreview from "../flow-canvas/StageFieldPreview"
import OpportunityQuickView from "../sor/OpportunityQuickView"
import OpportunityBoard from "../sor/OpportunityBoard"
import RetailOrdersQueue from "../sor/RetailOrdersQueue"
import FlowStageControl from "../sor/FlowStageControl"
import PendingActionDecisions from "../sor/PendingActionDecisions"
import SorsViewTabs from "../sor/SorsViewTabs"
import SorsTotals from "../sor/SorsTotals"
import SaleTypeFilter from "../sor/SaleTypeFilter"
import FollowUpCadenceEditor from "../flow-canvas/FollowUpCadenceEditor"
import EmployeeGroupManager from "../settings/EmployeeGroupManager"
import { FlowDataContext } from "../flow-canvas/FlowDataContext"
import ApproveOffsetModal from "../offsets/ApproveOffsetModal"
import TemplateTokenText from "../ui/TemplateTokenText"
import { Button } from "../ui/button"
import { useQuery } from "@tanstack/react-query"
import OpportunityDetailsModal from "../sor/OpportunityDetailsModal"
import StatusBadge from "../StatusBadge"
import { opportunityService } from "../../services/opportunityService"
import { formatPHP, matchesSaleType } from "../../constants/sor"
import { CONDITION_STATUS } from "../../constants/stageGate"
import SampleProvider, { ReadOnly } from "./SampleProvider"
import {
  SALE_TYPE_ID,
  SAMPLE_BOARD_OPPORTUNITIES,
  SAMPLE_CANVAS,
  SAMPLE_FLOW_STAGES_INDEX,
  SAMPLE_OPPORTUNITY,
  SAMPLE_SALE_TYPE,
} from "./sampleData"

/**
 * The SORS screens and the modals around them, as the app's own components
 * fed made-up data (ADR 0022). Each sample sits in a SampleProvider whose
 * cache is pre-filled, so nothing here reaches the network. A modal opens from
 * a "Click me" button, because opening it is what the row is about.
 */

const noop = () => {}
const SAMPLE_ACTOR = "sample-actor"
const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString()

function ClickMe({ children }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="space-y-3">
      <Button type="button" onClick={() => setOpen(true)}>
        Click me
      </Button>
      {children(open, () => setOpen(false), setOpen)}
    </div>
  )
}

const SEED_CANVAS = [["salesFlow", SALE_TYPE_ID], SAMPLE_CANVAS]

const PENDING_ACTIONS = [
  {
    runId: "run-1",
    title: "S99002 - Send bid clarification to client",
    stageName: "Bid Submitted",
    target: { kind: "individual", assignee: { name: "Maria Duran" } },
  },
]

/* ── Quick View ─────────────────────────────────────────────────────────── */

const QUICK_TASKS = [
  {
    id: "t1",
    kind: "individual",
    title: "Prepare technical compliance sheet",
    taskDescription: "Match every line of the TOR to the offered specification.",
    dueAt: inDays(3),
    priority: "HIGH",
  },
  {
    id: "g1",
    kind: "group",
    title: "Bid pack - S99002",
    taskDescription: "Assemble and submit the bid documents.",
    dueAt: inDays(5),
    checklistProgress: { checked: 1, total: 3 },
  },
]

const QUICK_CHECKLIST = [
  { status: CONDITION_STATUS.UNSATISFIED, condition: { id: "c1", label: "Bid security attached" } },
  { status: CONDITION_STATUS.UNSATISFIED, condition: { id: "c2", label: "Bid Deadline filled in" } },
  { status: CONDITION_STATUS.SATISFIED, condition: { id: "c3", label: "Client company confirmed" } },
]

export function QuickViewSample() {
  return (
    <SampleProvider
      seed={[
        [["quickViewTasks", SAMPLE_OPPORTUNITY.id, SAMPLE_ACTOR], QUICK_TASKS],
        [["quickViewChecklist", SAMPLE_OPPORTUNITY.id, SAMPLE_OPPORTUNITY.flow_stage_id], QUICK_CHECKLIST],
      ]}
    >
      <ClickMe>
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
      </ClickMe>
    </SampleProvider>
  )
}

/* ── SORS title, tabs, totals, filter ───────────────────────────────────── */

export function SorsRenameSample() {
  const [view, setView] = useState("list")
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3">
      {/* The register itself dropped this title when its header split into two
          rows — the SideNav already says where you are. This slide keeps it,
          because the rename to "SORS" is the whole point of the slide. */}
      <h1 className="shrink-0 text-sm font-black uppercase tracking-widest text-foreground">
        SORS
      </h1>
      <SorsViewTabs view={view} onChange={setView} />
    </div>
  )
}

export function OpenPipelineSample() {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3">
      <SorsViewTabs view="list" onChange={noop} />
      <SorsTotals openValue={353727836.94} wonValue={56711120} />
    </div>
  )
}

export function ItbWonSample() {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3">
        <SorsTotals openValue={353727836.94} wonValue={56711120} />
      </div>
      <div className="max-w-sm">
        <StageFieldPreview
          draft={{
            label: "ITB Number",
            source: "custom",
            isRequired: false,
            help: "Ask for it on the Stages that need it.",
            fieldType: "text",
            options: [],
          }}
        />
      </div>
    </div>
  )
}

const FILTER_SALE_TYPES = [
  SAMPLE_SALE_TYPE,
  { id: "st-2", name: "Private", archived_at: null },
  { id: "st-3", name: "Retail (old)", archived_at: "2026-08-01" },
]

const MOCK_SORS = [
  { id: "m1", ref: "S99001", client: "Demo Hospital", sale_type_id: SALE_TYPE_ID, stage: "Lead", value: 480000 },
  { id: "m2", ref: "S99002", client: "Demo City LGU", sale_type_id: SALE_TYPE_ID, stage: "Bid Submitted", value: 1250000 },
  { id: "m3", ref: "S99003", client: "Demo Province", sale_type_id: SALE_TYPE_ID, stage: "Awarded", value: 3100000 },
  { id: "m4", ref: "S99004", client: "Demo Trading Co.", sale_type_id: "st-2", stage: "Quotation Sent", value: 210000 },
  { id: "m5", ref: "S99005", client: "Demo Clinic", sale_type_id: "st-2", stage: "Won", value: 89000 },
  { id: "m6", ref: "S99006", client: "Demo Distributor", sale_type_id: "st-3", stage: "Closed", value: 64000 },
  { id: "m7", ref: "S05512", client: "Demo School (old)", sale_type_id: null, stage: "PO Received", value: 520000 },
  { id: "m8", ref: "S05530", client: "Demo LGU (old)", sale_type_id: null, stage: "Lead", value: 97000 },
]

export function SorsFiltersSample() {
  const [value, setValue] = useState("ALL")
  const rows = MOCK_SORS.filter((o) => matchesSaleType(o, value))
  const nameOf = (id) => FILTER_SALE_TYPES.find((s) => s.id === id)?.name ?? "No Sale Type (legacy)"
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-64">
          <SaleTypeFilter saleTypes={FILTER_SALE_TYPES} value={value} onChange={setValue} className="w-full" />
        </div>
        <p className="text-[13px] font-semibold text-muted-foreground">
          Showing {rows.length} of {MOCK_SORS.length} SORs
        </p>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Sales Ref.</TableHead>
              <TableHead>Company</TableHead>
              <TableHead>Sale Type</TableHead>
              <TableHead>Stage</TableHead>
              <TableHead className="text-right">Expected value</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((o) => (
              <TableRow key={o.id}>
                <TableCell className="font-mono text-xs font-bold text-foreground">{o.ref}</TableCell>
                <TableCell className="font-medium text-foreground">{o.client}</TableCell>
                <TableCell className="text-muted-foreground">{nameOf(o.sale_type_id)}</TableCell>
                <TableCell>
                  <StatusBadge label={o.stage} theme="mauve" />
                </TableCell>
                <TableCell className="text-right font-bold text-foreground">{formatPHP(o.value)}</TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                  No SORs match this filter.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
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
      <div className="h-[420px]">
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

/* ── Retail ─────────────────────────────────────────────────────────────── */

const RETAIL_ORDERS = [
  {
    id: "r1",
    odoo_so_number: "S45118",
    odoo_partner_name: "Shopee - Demo Buyer",
    odoo_salesperson_name: "Maria Duran",
    odoo_date_order: "2026-09-19",
    odoo_amount: 4590,
  },
  {
    id: "r2",
    odoo_so_number: "S45121",
    odoo_partner_name: "Lazada - Demo Buyer",
    odoo_salesperson_name: "Raquel Galacgac",
    odoo_date_order: "2026-09-20",
    odoo_amount: 12800,
  },
]

export function RetailSample() {
  return (
    <SampleProvider seed={[[["retailQueue", "pending"], RETAIL_ORDERS]]}>
      <ReadOnly>
        <RetailOrdersQueue />
      </ReadOnly>
    </SampleProvider>
  )
}

/* ── SOR window ─────────────────────────────────────────────────────────── */

/**
 * Not sample data. This deck is a Super Admin screen in the environment it
 * describes, so this one opens the real SOR window on the newest SOR the
 * register would list, through the same query the register uses. It is a real
 * record: what you do in the window is done to it.
 */
export function SorWindowSample() {
  const { data: sors = [], isLoading, isError } = useQuery({
    queryKey: ["opportunities"],
    queryFn: () => opportunityService.getOpportunities(),
  })
  const sor = sors.find((o) => o.sale_type_id) || sors[0] || null

  if (isLoading) return <p className="text-[14px] text-muted-foreground">Loading a real SOR…</p>
  if (isError || !sor) {
    return <p className="text-[14px] text-muted-foreground">No SOR in this environment to open.</p>
  }

  return (
    <div className="space-y-3">
      <p className="text-[14px] text-muted-foreground">
        Live data: opens {sor.sales_reference || "an SOR"} - {sor.client_name}, the newest SOR you can see.
      </p>
      <ClickMe>
        {(open, close) => <OpportunityDetailsModal isOpen={open} onClose={close} opportunity={sor} />}
      </ClickMe>
    </div>
  )
}

/* ── Blocked move ───────────────────────────────────────────────────────── */

export function BlockedMoveSample() {
  return (
    <SampleProvider seed={[SEED_CANVAS]}>
      <div className="max-w-3xl space-y-6">
        <div className="space-y-2">
          <p className="text-[13px] font-semibold text-muted-foreground">A required field and a condition are open</p>
          <FlowStageControl
            opportunity={SAMPLE_OPPORTUNITY}
            onMove={noop}
            isMoving={false}
            blockedBy={["Bid Deadline", "Bid security attached"]}
          />
        </div>
        <div className="space-y-2">
          <p className="text-[13px] font-semibold text-muted-foreground">Everything answered</p>
          <FlowStageControl opportunity={SAMPLE_OPPORTUNITY} onMove={noop} isMoving={false} blockedBy={[]} />
        </div>
      </div>
    </SampleProvider>
  )
}

/* ── Stage automation ───────────────────────────────────────────────────── */

const SAMPLE_CADENCE = {
  enabled: true,
  everyDays: 7,
  proofRequired: true,
  recipients: [{ type: "role", role: "deal_owner" }],
}

const SAMPLE_FLOW_DATA = {
  followUp: { getForStage: async () => SAMPLE_CADENCE, save: async () => {} },
}

export function StageAutomationSample() {
  return (
    <SampleProvider
      seed={[
        [["followUpCadence", "s-bid"], SAMPLE_CADENCE],
        [["pendingActionDecisions", SAMPLE_OPPORTUNITY.id, SAMPLE_ACTOR], PENDING_ACTIONS],
        [["employees"], []],
        [["employeeGroups", "all"], []],
      ]}
    >
      <ReadOnly>
        <FlowDataContext.Provider value={SAMPLE_FLOW_DATA}>
          <div className="grid max-w-4xl grid-cols-1 gap-6 xl:grid-cols-2">
            <div className="min-w-0 space-y-3">
              <p className="text-[13px] font-semibold text-muted-foreground">Task title template</p>
              <p className="rounded-xl border border-border bg-card px-4 py-3 text-sm font-semibold text-foreground">
                <TemplateTokenText text="{{so_number}} - Prepare technical compliance sheet" />
              </p>
              <p className="text-[13px] font-semibold text-muted-foreground">Optional Action waiting on you</p>
              <PendingActionDecisions opportunity={SAMPLE_OPPORTUNITY} actorId={SAMPLE_ACTOR} onChanged={noop} />
            </div>
            <div className="min-w-0 space-y-3">
              <p className="text-[13px] font-semibold text-muted-foreground">Follow-up Cadence on a Stage</p>
              <FollowUpCadenceEditor stageId="s-bid" />
            </div>
          </div>
        </FlowDataContext.Provider>
      </ReadOnly>
    </SampleProvider>
  )
}

/* ── Offset leave ───────────────────────────────────────────────────────── */

const OFFSET_REQUEST = {
  leave_group_id: "sample-group",
  hours: 8,
  dayCount: 2,
  date: "2026-09-24",
  employee: { name: "Maria Duran" },
}

export function OffsetSample() {
  return (
    <ClickMe>
      {(open, close) => (
        <ApproveOffsetModal isOpen={open} onClose={close} request={OFFSET_REQUEST} hrId={SAMPLE_ACTOR} onSuccess={noop} />
      )}
    </ClickMe>
  )
}

/* ── Employee Groups ────────────────────────────────────────────────────── */

const SAMPLE_GROUPS = [
  { id: "g1", name: "Purchasing", description: "Everyone who raises purchase orders", archived_at: null, memberIds: ["e1", "e2", "e3"], teams: [] },
  { id: "g2", name: "Sales Directors", description: null, archived_at: null, memberIds: ["e4"], teams: [] },
  { id: "g3", name: "Old Bid Team", description: "Replaced in August", archived_at: "2026-08-20", memberIds: ["e1", "e5"], teams: [] },
]

export function EmployeeGroupsSample() {
  return (
    <SampleProvider
      seed={[
        [["employeeGroups", "all"], SAMPLE_GROUPS],
        [["employees"], []],
      ]}
    >
      <ReadOnly>
        <div className="max-w-2xl">
          <EmployeeGroupManager />
        </div>
      </ReadOnly>
    </SampleProvider>
  )
}
