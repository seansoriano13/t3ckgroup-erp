import { useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Plus, Search, SlidersHorizontal } from "lucide-react"
import OpportunityDetailsModal from "../sor/OpportunityDetailsModal"
import SorsViewTabs from "../sor/SorsViewTabs"
import SorsTotals from "../sor/SorsTotals"
import FlowAccessSettings from "../flow-canvas/FlowAccessSettings"
import { FlowDataContext } from "../flow-canvas/FlowDataContext"
import { PROTOTYPE_ENABLED } from "../sor/modal/prototype/PrototypeSwitcher"
import TabGroup from "../ui/TabGroup"
import SaveDefaultButton from "../ui/SaveDefaultButton"
import { SelectField } from "../ui/SelectField"
import { FilterTrigger } from "../ui/FilterDropdown"
import { Input } from "../ui/input"
import { Button } from "../ui/button"
import { opportunityService } from "../../services/opportunityService"
import SampleProvider from "./SampleProvider"
import { ScreenshotPair } from "./BeforeAfter"

/**
 * The headline rows of "What shipped since 21 September" (ADR 0022). Two of
 * them open the demo SOR live; the rest are the app's own components fed
 * made-up data, so nothing they save reaches a real row.
 */

const noop = () => {}

function ClickMe({ label, children }) {
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

/* ── The demo SOR ───────────────────────────────────────────────────────── */

/**
 * The newest SOR scripts/seed-release-demo.mjs made: a Scratch SOR on the
 * "ZZ Demo — Government" copy, every person on it a demo account. Anything
 * clicked in it is real — moves, Reverts, tasks — and reaches nobody real.
 */
function DemoSor({ steps }) {
  const { data: sor, isLoading, isError } = useQuery({
    queryKey: ["releaseDemoSor"],
    queryFn: () => opportunityService.getReleaseDemoSor(),
  })

  if (isLoading) return <p className="text-[14px] text-muted-foreground">Loading the demo SOR…</p>
  if (isError || !sor) {
    return (
      <p className="text-[14px] text-muted-foreground">
        No demo SOR in this environment. Run <code>node scripts/seed-release-demo.mjs --apply</code> first.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-[14px] text-muted-foreground">
        Live: {sor.sales_reference} - {sor.client_name}. A Scratch SOR on a copy of the Government flow; everyone on
        it is a demo account, so click anything.
      </p>
      <ol className="list-decimal space-y-1 pl-5 text-[14px] text-foreground">
        {steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <ClickMe label="Open the demo SOR">
        {(open, close) => <OpportunityDetailsModal isOpen={open} onClose={close} opportunity={sor} />}
      </ClickMe>
    </div>
  )
}

export function LayoutPreviewSample() {
  if (!PROTOTYPE_ENABLED) {
    return <p className="text-[14px] text-muted-foreground">The Layout preview bar exists on staging only.</p>
  }
  return (
    <DemoSor
      steps={[
        "Open the demo SOR.",
        "Use the Layout preview bar at the bottom of the window: the menu, the arrows, or Shift + ← / →.",
        "Ask the room to pick one. The pick is remembered for every SOR opened afterwards.",
      ]}
    />
  )
}

export function RevertReturnSample() {
  return (
    <DemoSor
      steps={[
        "It sits on For Bidding: one Group Task live, five on hold from the Stages it left, a Stage Field answered.",
        "Revert to last stage: work was done, so it asks Keep progress or Remove progress.",
        "Move it forward to For Bidding again: it was there before, so it asks Resume previous work or Start fresh.",
      ]}
    />
  )
}

/* ── Always sees · Always edits ─────────────────────────────────────────── */

const DEMO_EMPLOYEES = [
  { id: "e1", name: "Maria Duran", department: "SALES", sub_department: "GOVERNMENT" },
  { id: "e2", name: "Raquel Galacgac", department: "OPERATIONS", sub_department: "PURCHASING" },
  { id: "e3", name: "Sherwin Saliva", department: "OPERATIONS", sub_department: "TECHNICAL" },
]
const DEMO_GROUPS = [{ id: "g1", name: "Bid Committee", memberIds: ["e1", "e3"], teams: [] }]
const INITIAL_ACCESS = {
  alwaysSees: [{ type: "everyone" }],
  alwaysEdits: [{ type: "group", id: "g1" }],
  journeyViewers: null,
}

export function AlwaysAccessSample() {
  // The popover saves through FlowDataContext; a ref keeps the edits on the
  // slide, so a change made in front of the room sticks until the page
  // reloads, and the refetch after a save reads it back.
  const store = useRef(INITIAL_ACCESS)
  const [flowData] = useState(() => ({
    flowAccess: {
      getForFlow: async () => store.current,
      saveForFlow: async (_flowId, payload) => {
        store.current = payload
      },
    },
  }))

  return (
    <SampleProvider
      seed={[
        [["employees"], DEMO_EMPLOYEES],
        [["employeeGroups", "all"], DEMO_GROUPS],
        [["flowAccess", "sample-flow"], INITIAL_ACCESS],
      ]}
    >
      <FlowDataContext.Provider value={flowData}>
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3">
            <span className="text-[14px] font-semibold text-foreground">Flow Canvas toolbar · Access settings</span>
            <FlowAccessSettings flowId="sample-flow" />
            <span className="text-[13px] text-muted-foreground">← click the shield</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              ["Legacy Pipeline", "Always sees: Everyone · Always edits: Everyone", "As before Sales Flows existed."],
              ["Government", "Private: Deal Team, Always sees, and people called in", "Set per flow."],
              ["Outright", "Private: Deal Team, Always sees, and people called in", "Set per flow."],
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

/* ── Settings in tabs, saved task filters ───────────────────────────────── */

const SETTINGS_TABS = [
  { value: "general", label: "General", holds: "Company details, Lead Sources, the Commission Pool card." },
  { value: "approvals", label: "Approval Rules", holds: "Who approves what. A change reaches open approval queues at once." },
  { value: "hr", label: "HR & Schedule", holds: "Leave categories (moved here from HR Management) and work schedules." },
  { value: "sales", label: "Sales Configuration", holds: "Sale Types, Sales Flows and the registration form." },
  { value: "groups", label: "Employee Groups", holds: "Named sets of employees and teams, reused by Sales Flows." },
  { value: "announcements", label: "System Announcements", holds: "Banners and What's new." },
]

const PRIORITIES = ["All priorities", "High", "Medium", "Low"].map((p) => ({ value: p, label: p }))
const STATUSES = ["All statuses", "Incomplete", "Awaiting approval", "Complete"].map((s) => ({ value: s, label: s }))

export function SettingsTabsSample() {
  const [tab, setTab] = useState("general")
  const [filters, setFilters] = useState({ priority: "All priorities", status: "All statuses" })
  const [saved, setSaved] = useState(null)
  const holds = SETTINGS_TABS.find((t) => t.value === tab)?.holds

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <p className="text-[13px] font-semibold text-muted-foreground">Settings</p>
        <TabGroup tabs={SETTINGS_TABS.map(({ value, label }) => ({ value, label }))} activeTab={tab} onChange={setTab} />
        <p className="text-[15px] text-foreground">{holds}</p>
      </div>
      <div className="space-y-3">
        <p className="text-[13px] font-semibold text-muted-foreground">Tasks · filters</p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-48">
            <SelectField
              label="Priority"
              options={PRIORITIES}
              value={filters.priority}
              onChange={(e) => setFilters((f) => ({ ...f, priority: e.target.value }))}
            />
          </div>
          <div className="w-48">
            <SelectField
              label="Status"
              options={STATUSES}
              value={filters.status}
              onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
            />
          </div>
          <SaveDefaultButton
            hasSavedDefault={saved != null}
            isDirty={saved != null && JSON.stringify(saved) !== JSON.stringify(filters)}
            onSave={() => setSaved(filters)}
            onClear={() => setSaved(null)}
          />
        </div>
      </div>
    </div>
  )
}

/* ── One-row SORS header ────────────────────────────────────────────────── */

export function SorsHeaderSample() {
  const [view, setView] = useState("list")
  const [search, setSearch] = useState("")
  const filtering = view === "list" || view === "board"

  return (
    <div className="relative space-y-3 pb-16">
      {/* The register's own header row, built from the same parts. */}
      <div className="flex h-14 min-w-0 items-center gap-2 rounded-2xl border border-border bg-card px-4 sm:gap-3">
        {filtering && (
          <>
            <div className="flex h-9 min-w-[7rem] max-w-[360px] flex-1 items-center gap-2 rounded-xl border border-border bg-muted/30 px-3">
              <Search size={15} className="shrink-0 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search number, client, project, Deal Owner…"
                containerClassName="w-full"
                className="h-auto rounded-none border-0 bg-transparent px-0 py-0 text-sm font-medium shadow-none focus-visible:ring-0"
              />
            </div>
            <SorsTotals count={120} openValue={210500000} wonValue={38250000} />
          </>
        )}
        <div className="flex-1" />
        <SorsViewTabs view={view} onChange={setView} />
        <FilterTrigger
          className="h-9 w-auto gap-2 px-3"
          icon={SlidersHorizontal}
          label="Filters"
          count={filtering ? 2 : 0}
          isActive={filtering}
          disabled={!filtering}
        />
      </div>
      <p className="text-[14px] text-muted-foreground">
        Switch to Overview or Deleted: search and the figures drop out, the tabs and Filters stay where they are.
      </p>
      <Button type="button" onClick={noop} className="absolute bottom-0 right-2 gap-2 rounded-full py-3.5 pl-4 pr-5 text-[13px] font-bold shadow-[0_10px_30px_-8px_rgb(0_0_0/0.45)]">
        <Plus size={16} strokeWidth={2.5} />
        Register SOR
      </Button>
    </div>
  )
}

/* ── One consistent look ────────────────────────────────────────────────── */

export function ConsistentLookSample() {
  return (
    <ScreenshotPair
      name="consistent-look"
      before="Each screen drew its own: the browser's plain dropdown, hand-made tables and pop-ups."
      after="The same pick-list, table and pop-up on every screen, with keyboard support."
    />
  )
}
