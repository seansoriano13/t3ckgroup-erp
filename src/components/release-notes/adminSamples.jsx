import { useRef, useState } from "react"
import { ReactFlowProvider } from "@xyflow/react"
import TabGroup from "@/components/ui/TabGroup"
import FlowCanvasNode from "../flow-canvas/FlowCanvasNode"
import ChoiceOptionsEditor from "../flow-canvas/ChoiceOptionsEditor"
import StageFieldPreview from "../flow-canvas/StageFieldPreview"
import FollowUpCadenceEditor from "../flow-canvas/FollowUpCadenceEditor"
import FlowAccessSettings from "../flow-canvas/FlowAccessSettings"
import { FlowDataContext } from "../flow-canvas/FlowDataContext"
import PendingActionDecisions from "../sor/PendingActionDecisions"
import EmployeeGroupManager from "../settings/EmployeeGroupManager"
import TemplateTokenText from "../ui/TemplateTokenText"
import SampleProvider, { ReadOnly } from "./SampleProvider"
import { FLOW_ID, PEOPLE, SAMPLE_ACTOR, SAMPLE_EMPLOYEES, SAMPLE_OPPORTUNITY } from "./sampleData"

/**
 * Setting up Sales Flows, access and Settings: the Flow Canvas's own parts
 * and the Settings screens, fed Sample Data (ADR 0030).
 */

const noop = () => {}

const stage = (name, extra = {}) => ({ id: name, name, color: "mauve", is_terminal: false, ...extra })
const person = (p) => ({ employeeId: p.id, name: p.name, calls: [] })
const noAudience = { calledIn: [], shutOutGroups: [], counts: { calledIn: 0, shutOutRoles: 0 } }

function NodeSample({ name, stage: stageExtra, ...data }) {
  return (
    <ReactFlowProvider>
      <FlowCanvasNode
        data={{
          stage: stage(name, stageExtra),
          isEntry: false,
          isWon: false,
          disabled: true,
          conditionCount: 0,
          actionCount: 0,
          fieldCount: 0,
          audience: noAudience,
          ...data,
        }}
      />
    </ReactFlowProvider>
  )
}

/* ── Flow Canvas: edit a Stage in place ─────────────────────────────────── */

export function CanvasEditingSample() {
  const [options, setOptions] = useState(["Public bidding", "Direct contracting", "Negotiated"])
  const draft = {
    label: "Procurement mode",
    source: "custom",
    sorField: null,
    isRequired: true,
    help: "As written in the bid documents.",
    fieldType: "choice",
    options,
  }
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start gap-x-6 gap-y-16 pb-10">
        <NodeSample name="Lead" stage={{ color: "blue" }} conditionCount={1} />
        <NodeSample name="Bidding" stage={{ color: "amber" }} conditionCount={2} actionCount={1} fieldCount={3} />
        <NodeSample name="Awarded" stage={{ color: "green", is_terminal: true }} isWon />
      </div>
      <div className="w-full max-w-sm space-y-3">
        <ChoiceOptionsEditor options={options} onChange={setOptions} />
        <StageFieldPreview draft={draft} />
      </div>
    </div>
  )
}

/* ── Who can open an SOR ────────────────────────────────────────────────── */

export function StageAccessSample() {
  return (
    <div className="flex flex-wrap items-start gap-x-6 gap-y-12 pb-8">
      <NodeSample name="Technical Review" />
      <NodeSample
        name="Bid Submitted"
        audience={{
          calledIn: [person(PEOPLE.lara), person(PEOPLE.joy)],
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

/* ── Always sees · Always edits ─────────────────────────────────────────── */

const SAMPLE_GROUPS_SMALL = [
  { id: "g1", name: "Bid Committee", employeeIds: [PEOPLE.lara.id, PEOPLE.carlo.id], memberIds: [PEOPLE.lara.id, PEOPLE.carlo.id], teams: [] },
]
const INITIAL_ACCESS = {
  alwaysSees: [{ type: "everyone" }],
  alwaysEdits: [{ type: "group", id: "g1" }],
  journeyViewers: null,
}

export function AlwaysAccessSample() {
  // The popover reads through FlowDataContext; a ref holds what it shows, so
  // the sample opens on the same rules every time. Saving is refused by
  // SampleProvider before this store is ever asked.
  const store = useRef(INITIAL_ACCESS)
  const [flowData] = useState(() => ({
    flowAccess: {
      getForFlow: async () => store.current,
      saveForFlow: async () => {},
    },
  }))

  return (
    <SampleProvider
      seed={[
        [["employees"], SAMPLE_EMPLOYEES],
        [["employeeGroups", "all"], SAMPLE_GROUPS_SMALL],
        [["flowAccess", FLOW_ID], INITIAL_ACCESS],
      ]}
    >
      <FlowDataContext.Provider value={flowData}>
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3">
            <span className="text-[14px] font-semibold text-foreground">Flow Canvas · Access settings</span>
            <FlowAccessSettings flowId={FLOW_ID} />
            <span className="text-[13px] text-muted-foreground">← click the shield</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              ["SORs from before Sales Flows", "Always sees: Everyone · Always edits: Everyone", "As they always were."],
              ["Government", "Deal Team, Always sees, and people called in", "Set per flow."],
              ["Outright", "Deal Team, Always sees, and people called in", "Set per flow."],
            ].map(([flow, rule, note]) => (
              <div key={flow} className="rounded-xl border border-border bg-card px-4 py-3">
                <p className="text-[15px] font-bold text-foreground">{flow}</p>
                <p className="mt-1 text-[14px] text-foreground">{rule}</p>
                <p className="mt-1 text-[13px] text-muted-foreground">{note}</p>
              </div>
            ))}
          </div>
        </div>
      </FlowDataContext.Provider>
    </SampleProvider>
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
          label: "Bid deadline",
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

/* ── Stage Automation ───────────────────────────────────────────────────── */

const SAMPLE_CADENCE = {
  enabled: true,
  everyDays: 7,
  proofRequired: true,
  recipients: [{ type: "role", role: "deal_owner" }],
}

const PENDING_ACTIONS = [
  {
    runId: "run-1",
    title: "S00002 - Send bid clarification to the client",
    stageName: "Bid Submitted",
    target: { kind: "individual", assignee: { name: PEOPLE.lara.name } },
  },
]

const SAMPLE_FLOW_DATA = {
  followUp: { getForStage: async () => SAMPLE_CADENCE, save: async () => {} },
}

export function StageAutomationSample() {
  return (
    <SampleProvider
      seed={[
        [["followUpCadence", "s-bid"], SAMPLE_CADENCE],
        [["pendingActionDecisions", SAMPLE_OPPORTUNITY.id, SAMPLE_ACTOR], PENDING_ACTIONS],
        [["employees"], SAMPLE_EMPLOYEES],
        [["employeeGroups", "all"], []],
      ]}
    >
      <ReadOnly>
        <FlowDataContext.Provider value={SAMPLE_FLOW_DATA}>
          <div className="grid max-w-4xl grid-cols-1 gap-6 xl:grid-cols-2">
            <div className="min-w-0 space-y-3">
              <p className="text-[13px] font-semibold text-muted-foreground">Task title template</p>
              <p className="rounded-xl border border-border bg-card px-4 py-3 text-sm font-semibold text-foreground">
                <TemplateTokenText text="{{so_number}} - Prepare the technical compliance sheet" />
              </p>
              <p className="text-[13px] font-semibold text-muted-foreground">An Optional Action waiting on you</p>
              <PendingActionDecisions opportunity={SAMPLE_OPPORTUNITY} actorId={SAMPLE_ACTOR} onChanged={noop} />
            </div>
            <div className="min-w-0 space-y-3">
              <p className="text-[13px] font-semibold text-muted-foreground">Follow-up reminders on a Stage</p>
              <FollowUpCadenceEditor stageId="s-bid" />
            </div>
          </div>
        </FlowDataContext.Provider>
      </ReadOnly>
    </SampleProvider>
  )
}

/* ── Employee Groups ────────────────────────────────────────────────────── */

const group = (id, name, description, ids, archived_at = null) => ({
  id,
  name,
  description,
  archived_at,
  employeeIds: ids,
  teams: [],
  memberIds: ids,
  members: SAMPLE_EMPLOYEES.filter((p) => ids.includes(p.id)),
})

const SAMPLE_GROUPS = [
  group("g1", "Purchasing", "Everyone who raises purchase orders", [PEOPLE.joy.id, PEOPLE.carlo.id]),
  group("g2", "Sales Directors", null, [PEOPLE.mark.id]),
  group("g3", "Old Bid Team", "Replaced in August", [PEOPLE.lara.id, PEOPLE.paolo.id], "2026-08-20"),
]

export function EmployeeGroupsSample() {
  return (
    <SampleProvider
      seed={[
        [["employeeGroups", "all"], SAMPLE_GROUPS],
        [["employees"], SAMPLE_EMPLOYEES],
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

/* ── Settings in tabs ───────────────────────────────────────────────────── */

const SETTINGS_TABS = [
  { value: "general", label: "General", holds: "Company details and Lead Sources." },
  { value: "approvals", label: "Approval Rules", holds: "Who approves what. A change reaches open approval queues at once." },
  { value: "hr", label: "HR & Schedule", holds: "Leave categories, moved here from HR Management, and work schedules." },
  { value: "sales", label: "Sales Configuration", holds: "Sale Types, Sales Flows, the registration form, and a link to the commission rules on the Commission Dashboard." },
  { value: "groups", label: "Employee Groups", holds: "Named sets of people and teams, reused by Sales Flows." },
  { value: "announcements", label: "System Announcements", holds: "Banners and What's new." },
]

export function SettingsTabsSample() {
  const [tab, setTab] = useState("general")
  const holds = SETTINGS_TABS.find((t) => t.value === tab)?.holds
  return (
    <div className="space-y-4">
      <TabGroup variant="underline" tabs={SETTINGS_TABS.map(({ value, label }) => ({ value, label }))} activeTab={tab} onChange={setTab} />
      <p className="text-[15px] text-foreground">{holds}</p>
    </div>
  )
}
