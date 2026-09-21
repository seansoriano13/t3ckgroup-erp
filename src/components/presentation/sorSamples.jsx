import { useState } from "react"
import StageFieldPreview from "../settings/StageFieldPreview"
import { ItemStockRow } from "../sor/modal/ItemsTab"
import SorModalHeader from "../sor/modal/SorModalHeader"
import ModalTaskRow from "../sor/modal/TaskRow"
import OpportunityQuickView from "../sor/OpportunityQuickView"
import OpportunityBoard from "../sor/OpportunityBoard"
import RetailOrdersQueue from "../sor/RetailOrdersQueue"
import FlowStageControl from "../sor/FlowStageControl"
import PendingActionDecisions from "../sor/PendingActionDecisions"
import SorsViewTabs from "../sor/SorsViewTabs"
import SorsTotals from "../sor/SorsTotals"
import SaleTypeFilter from "../sor/SaleTypeFilter"
import FollowUpCadenceEditor from "../settings/FollowUpCadenceEditor"
import EmployeeGroupManager from "../settings/EmployeeGroupManager"
import { FlowDataContext } from "../settings/FlowDataContext"
import ApproveOffsetModal from "../offsets/ApproveOffsetModal"
import TemplateTokenText from "../ui/TemplateTokenText"
import TabGroup from "../ui/TabGroup"
import { Button } from "../ui/button"
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog"
import { CONDITION_STATUS } from "../../constants/stageGate"
import SampleProvider, { ReadOnly } from "./SampleProvider"
import {
  SALE_TYPE_ID,
  SAMPLE_BOARD_OPPORTUNITIES,
  SAMPLE_CANVAS,
  SAMPLE_FLOW_STAGES_INDEX,
  SAMPLE_OPPORTUNITY,
  SAMPLE_SALE_TYPE,
  SAMPLE_SNAPSHOT,
  SAMPLE_STAGES,
  STOCK_SNAPSHOT,
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
const SEED_SNAPSHOT = [["flowSnapshot", SAMPLE_SNAPSHOT.id], SAMPLE_SNAPSHOT]

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
  { status: CONDITION_STATUS.UNSATISFIED, condition: { id: "c2", label: "ITB Number filled in" } },
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

export function SorsFiltersSample() {
  const [value, setValue] = useState("ALL")
  const saleTypes = [
    SAMPLE_SALE_TYPE,
    { id: "st-2", name: "Private", archived_at: null },
    { id: "st-3", name: "Retail (old)", archived_at: "2026-08-01" },
  ]
  return (
    <div className="w-64">
      <SaleTypeFilter saleTypes={saleTypes} value={value} onChange={setValue} className="w-full" />
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

const WINDOW_CHECKLIST = [
  { status: CONDITION_STATUS.UNSATISFIED, condition: { id: "c1", label: "Bid security attached", is_required: true } },
]

const WINDOW_TASKS = [
  {
    id: "t1",
    entityType: "TASK",
    kind: "group",
    title: "Bid pack - S99002",
    dueDate: inDays(5),
    doneCount: 1,
    totalCount: 3,
    members: [
      { id: "m1", name: "Maria Duran" },
      { id: "m2", name: "Raquel Galacgac" },
      { id: "m3", name: "Jose Aquino" },
    ],
  },
  {
    id: "t2",
    entityType: "TASK",
    kind: "individual",
    title: "Prepare technical compliance sheet",
    dueDate: inDays(3),
    doneCount: 0,
    totalCount: 1,
    members: [{ id: "m1", name: "Maria Duran" }],
  },
]

const WINDOW_STOCK_LINES = [
  { id: "a", name: "Stretcher, hydraulic", quantity: 12, odoo_product_id: 1 },
  { id: "b", name: "IV pole, 4-hook", quantity: 24, odoo_product_id: 3 },
]

export function SorWindowSample() {
  const [tab, setTab] = useState("now")
  const currentStage = SAMPLE_STAGES.find((s) => s.id === SAMPLE_OPPORTUNITY.flow_stage_id)
  return (
    <SampleProvider
      seed={[
        SEED_CANVAS,
        SEED_SNAPSHOT,
        [["pendingActionDecisions", SAMPLE_OPPORTUNITY.id, SAMPLE_ACTOR], PENDING_ACTIONS],
      ]}
    >
      <ClickMe>
        {(open, close, setOpen) => (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent className="max-h-[90vh] gap-0 overflow-y-auto p-0 sm:max-w-3xl">
              <DialogTitle className="sr-only">SOR window sample</DialogTitle>
              <SorModalHeader
                opportunity={SAMPLE_OPPORTUNITY}
                isEditing={false}
                editForm={{}}
                setEditForm={noop}
                handleEditToggle={noop}
                updateMutation={{ isPending: false }}
                deleteMutation={{ isPending: false }}
                isExpanded={false}
                setIsExpanded={noop}
                onClose={close}
                isFlowDeal
                flowCanvas={SAMPLE_CANVAS}
                currentFlowStage={currentStage}
                currentFlowStageTone="mauve"
                pipelineStages={[]}
                stageMutation={{ isPending: false, mutate: noop }}
                handleStageChange={noop}
                checklist={WINDOW_CHECKLIST}
                isOpen={open}
                hasPrev={false}
                hasNext={false}
                onPrev={noop}
                onNext={noop}
                accessLevel="full"
              />
              <div className="space-y-4 px-6 py-4">
                <TabGroup
                  tabs={[
                    { value: "now", label: "Now" },
                    { value: "items", label: "Items" },
                  ]}
                  activeTab={tab}
                  onChange={setTab}
                  variant="underline"
                />
                {tab === "now" ? (
                  <div className="space-y-4">
                    <ReadOnly>
                      <PendingActionDecisions opportunity={SAMPLE_OPPORTUNITY} actorId={SAMPLE_ACTOR} onChanged={noop} />
                    </ReadOnly>
                    <div className="space-y-2">
                      {WINDOW_TASKS.map((row) => (
                        <ModalTaskRow key={row.id} row={row} />
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {WINDOW_STOCK_LINES.map((line) => (
                      <div key={line.id} className="space-y-1">
                        <div className="flex justify-between text-sm font-medium text-foreground">
                          <span>{line.name}</span>
                          <span className="text-muted-foreground">x{line.quantity}</span>
                        </div>
                        <div className="grid grid-cols-12">
                          <ItemStockRow item={line} snapshotData={STOCK_SNAPSHOT} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </DialogContent>
          </Dialog>
        )}
      </ClickMe>
    </SampleProvider>
  )
}

/* ── Blocked move ───────────────────────────────────────────────────────── */

export function BlockedMoveSample() {
  return (
    <SampleProvider seed={[SEED_CANVAS]}>
      <div className="max-w-3xl space-y-6">
        <div className="space-y-2">
          <p className="text-[13px] font-semibold text-muted-foreground">A required field is empty</p>
          <FlowStageControl
            opportunity={SAMPLE_OPPORTUNITY}
            onMove={noop}
            isMoving={false}
            blockedBy={["ITB Number", "Bid security attached"]}
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
          <div className="grid max-w-4xl gap-6 lg:grid-cols-2">
            <div className="space-y-3">
              <p className="text-[13px] font-semibold text-muted-foreground">Task title template</p>
              <p className="rounded-xl border border-border bg-card px-4 py-3 text-sm font-semibold text-foreground">
                <TemplateTokenText text="{{so_number}} - Prepare technical compliance sheet" />
              </p>
              <p className="text-[13px] font-semibold text-muted-foreground">Optional Action waiting on you</p>
              <PendingActionDecisions opportunity={SAMPLE_OPPORTUNITY} actorId={SAMPLE_ACTOR} onChanged={noop} />
            </div>
            <div className="space-y-3">
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
