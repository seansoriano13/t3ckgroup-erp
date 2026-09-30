import { useState } from "react"
import { CalendarDays, Inbox } from "lucide-react"
import toast from "react-hot-toast"
import PageShell from "@/components/ui/PageShell"
import TabGroup from "@/components/ui/TabGroup"
import EmptyState from "@/components/ui/EmptyState"
import { Button } from "@/components/ui/button"
import TaskFilterBar from "../TaskFilterBar"
import RetailReport, { RetailRangeControl } from "../sor/RetailReport"
import PoolTab from "../sor/commission/PoolTab"
import { colourDepartments } from "../sor/commission/commissionView"
import { ApprovalTable } from "../../pages/approvals/_components/ApprovalTable"
import { ApprovalSheet } from "../../pages/approvals/_components/ApprovalSheet"
import { LeaveReview } from "../../pages/approvals/_components/LeaveReview"
import { leaveToItem } from "../../utils/approvalItems"
import ApproveOffsetModal from "../offsets/ApproveOffsetModal"
import SampleProvider, { SAMPLE_SAVE_BLOCKED } from "./SampleProvider"
import { PEOPLE, SAMPLE_ACTOR, SAMPLE_EMPLOYEES, daysAgo, hoursAgo, isoDate } from "./sampleData"

/**
 * Tasks, approvals, leaves, Retail and Commission, as the app's own
 * components fed Sample Data (ADR 0030).
 */

const noop = () => {}
const refuse = () => toast(SAMPLE_SAVE_BLOCKED)

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

/* ── Tasks: filters on one line ─────────────────────────────────────────── */

const TASK_FILTERS = {
  statusFilter: "ALL",
  priorityFilter: "ALL",
  sortBy: "NEWEST",
  timeframe: "YEARLY",
  selectedDateFilter: `${new Date().getFullYear()}`,
  deptFilter: "ALL",
  subDeptFilter: "ALL",
  employeeFilter: "ALL",
  reportedToFilter: "ALL",
  crmOnly: false,
}

export function TaskFiltersSample() {
  const [filters, setFilters] = useState(TASK_FILTERS)
  const [search, setSearch] = useState("")
  const [saved, setSaved] = useState(null)
  return (
    <SampleProvider>
      <TaskFilterBar
        searchTerm={search}
        onSearchChange={setSearch}
        filters={filters}
        onChange={(key, value) => setFilters((f) => ({ ...f, [key]: value }))}
        onClearAll={() => {
          setSearch("")
          setFilters(TASK_FILTERS)
        }}
        saveDefault={{
          hasSavedDefault: saved != null,
          isDirty: saved != null && JSON.stringify(saved) !== JSON.stringify(filters),
          onSave: () => setSaved(filters),
          onClear: () => setSaved(null),
        }}
        scope={{ canPickPeople: true, canPickDepartment: true }}
        departments={["SALES", "OPERATIONS", "HR"]}
        subDepartments={["GOVERNMENT", "PRIVATE", "PURCHASING", "TECHNICAL"]}
        people={SAMPLE_EMPLOYEES.map((p) => ({ id: p.id, name: p.name }))}
      />
    </SampleProvider>
  )
}

/* ── Approvals: one table, decide at the side ───────────────────────────── */

const leave = (id, person, requestType, extra) => ({
  id,
  table: "leave_requests",
  matchValue: id,
  requestType,
  employee: person,
  created_at: hoursAgo(extra.age),
  date: isoDate(extra.inDays),
  hours: extra.hours,
  start_time: extra.start ?? null,
  end_time: extra.end ?? null,
  reason: extra.reason,
})

const APPROVAL_ITEMS = [
  leave("lv-1", PEOPLE.lara, "SIL", { age: 3, inDays: 7, hours: 8, reason: "Family event in the province." }),
  leave("lv-2", PEOPLE.paolo, "OVERTIME", { age: 20, inDays: -1, hours: 3, start: "17:00", end: "20:00", reason: "Finished the bid documents for Demo Province." }),
  leave("lv-3", PEOPLE.carlo, "OFFSET", { age: 80, inDays: 3, hours: 4, reason: "Half day to make up for Saturday's delivery." }),
].map((r) => leaveToItem(r))

export function ApprovalCenterSample() {
  const [openId, setOpenId] = useState(null)
  const index = APPROVAL_ITEMS.findIndex((i) => i.id === openId)
  const item = APPROVAL_ITEMS[index] ?? null

  return (
    <SampleProvider>
      <div className="space-y-2">
        <ApprovalTable
          items={APPROVAL_ITEMS}
          queueIcon={CalendarDays}
          personLabel="Requested by"
          onOpen={(row) => setOpenId(row.id)}
          keyboard={false}
        />
        <p className="text-xs text-muted-foreground">Click a row to review it at the side.</p>
      </div>
      <ApprovalSheet
        item={item}
        queueLabel="Leave Approvals"
        queueIcon={CalendarDays}
        index={index}
        total={APPROVAL_ITEMS.length}
        onStep={(dir) => {
          const next = APPROVAL_ITEMS[index + dir]
          if (next) setOpenId(next.id)
        }}
        onClose={() => setOpenId(null)}
      >
        {(record) => <LeaveReview key={record.id} item={record} onDecide={refuse} isSubmitting={false} />}
      </ApprovalSheet>
    </SampleProvider>
  )
}

/* ── Offset leave: approve fewer hours ──────────────────────────────────── */

const OFFSET_REQUEST = {
  leave_group_id: "sample-group",
  hours: 8,
  dayCount: 2,
  date: isoDate(3),
  employee: { name: PEOPLE.carlo.name },
}

export function OffsetSample() {
  return (
    <SampleProvider>
      <OpenButton label="Open the approval">
        {(open, close) => <ApproveOffsetModal isOpen={open} onClose={close} request={OFFSET_REQUEST} hrId={SAMPLE_ACTOR} onSuccess={noop} />}
      </OpenButton>
    </SampleProvider>
  )
}

/* ── Retail report ──────────────────────────────────────────────────────── */

const RETAIL_ORDERS = (() => {
  const orders = []
  const stores = ["Shopee", "Lazada"]
  // Six months of made-up orders: a few a week, round amounts.
  for (let d = 0; d < 180; d += 3) {
    const store = stores[(d / 3) % 2]
    orders.push({
      id: `ro-${d}`,
      odoo_so_number: `S9${String(1000 + d).padStart(4, "0")}`,
      storefront: store,
      buyer_name: `${store} buyer`,
      ordered_at: daysAgo(d),
      amount: [1000, 2500, 5000, 1500][(d / 3) % 4],
      odoo_state: "sale",
      is_excluded: false,
    })
  }
  return orders
})()

export function RetailReportSample() {
  const [range, setRange] = useState("3m")
  const [custom, setCustom] = useState({ from: "", to: "" })
  return (
    <SampleProvider seed={[[["retailOrders"], RETAIL_ORDERS]]}>
      <div className="min-w-[640px] space-y-5">
        <div className="flex justify-end">
          <RetailRangeControl range={range} onRangeChange={setRange} custom={custom} onCustomChange={setCustom} />
        </div>
        <RetailReport range={range} custom={custom} />
      </div>
    </SampleProvider>
  )
}

/* ── Commission Dashboard ───────────────────────────────────────────────── */

const DEALS = [
  { id: "cd-1", opportunityNo: "OPP-0005", clientName: "Demo Town Hall", projectTitle: "Demo: ambulance", owner: PEOPLE.lara, projectType: "SSP", value: 2000000, ago: 15 },
  { id: "cd-2", opportunityNo: "OPP-0006", clientName: "Demo Health Office", projectTitle: "Demo: clinic fit-out", owner: PEOPLE.paolo, projectType: "SSP", value: 1000000, ago: 45 },
  { id: "cd-3", opportunityNo: "OPP-0008", clientName: "Demo Province", projectTitle: "Demo: rescue equipment", owner: PEOPLE.mark, projectType: "CP", value: 3000000, ago: 75 },
  { id: "cd-4", opportunityNo: "OPP-0009", clientName: "Demo School", projectTitle: "Demo: first-aid kits", owner: PEOPLE.lara, projectType: "SSP", value: 500000, ago: 105 },
].map((d) => ({
  id: d.id,
  opportunityNo: d.opportunityNo,
  clientName: d.clientName,
  projectTitle: d.projectTitle,
  projectType: d.projectType,
  status: "WON",
  contractDate: isoDate(-d.ago),
  contractValue: d.value,
  commissionableRevenue: d.value,
  commissionPool: d.value * 0.05,
  unattributedSalesAmount: 0,
  salesShareAmount: d.value * 0.025,
  salesRoleShares: [{ role: "deal_owner", amount: d.value * 0.025 }],
  createdAt: daysAgo(d.ago + 20),
  participants: { dealOwner: { id: d.owner.id, name: d.owner.name } },
}))

const DASHBOARD = {
  totalCommissionPool: 325000,
  totalCommissionableRevenue: 6500000,
  salesDeptTotal: 162500,
  totalDealsCount: 4,
  wonDealsCount: 4,
  dealLedger: DEALS,
  salesEmployees: [PEOPLE.lara, PEOPLE.paolo, PEOPLE.mark].map((p, i) => ({
    employeeId: p.id,
    name: p.name,
    avatarPath: null,
    totalCommissionShare: [62500, 25000, 75000][i],
    wonDealsCount: i === 0 ? 2 : 1,
  })),
  departmentTotals: [
    { name: "Sales", isSales: true, allocationPercent: 50, amount: 162500 },
    { name: "Operations", isSales: false, allocationPercent: 30, amount: 97500 },
    { name: "Management", isSales: false, allocationPercent: 20, amount: 65000 },
  ],
}

const COMMISSION_ACCESS = {
  dashboard: DASHBOARD,
  rates: { pool: 5 },
  user: { id: PEOPLE.lara.id },
  canViewAllFinancials: true,
  canViewSalesAmounts: true,
}

export function CommissionPoolSample() {
  return (
    <SampleProvider>
      {/* Two buttons leave the sample: the receipt's "Open SOR" goes to the
          real register, where a sample SOR does not exist, and Export CSV
          downloads a file. Stop both here instead. */}
      <div
        className="min-w-[640px]"
        onClickCapture={(event) => {
          const label = event.target.closest?.("button")?.textContent?.trim() ?? ""
          if (label.startsWith("Open SOR") || label.includes("Export CSV")) {
            event.preventDefault()
            event.stopPropagation()
            refuse()
          }
        }}
      >
        <PoolTab access={COMMISSION_ACCESS} departments={colourDepartments(DASHBOARD.departmentTotals)} initialDealId={null} />
      </div>
    </SampleProvider>
  )
}

/* ── Every page shares one layout ───────────────────────────────────────── */

export function PageLayoutSample() {
  const [tab, setTab] = useState("pending")
  return (
    <PageShell
      className="!px-0 !pb-0"
      title="Sample Page"
      description="The title and a line about the page, then the one main button on the right."
      action={<Button type="button" onClick={noop}>Main action</Button>}
      tabs={
        <TabGroup
          variant="underline"
          tabs={[
            { value: "pending", label: "Pending" },
            { value: "history", label: "History" },
          ]}
          activeTab={tab}
          onChange={setTab}
        />
      }
      toolbar={<p className="text-sm text-muted-foreground">Search and filters sit here, on one line.</p>}
    >
      <EmptyState icon={Inbox} title="Nothing waiting" description="Every page says the same kind of thing when it is empty." />
    </PageShell>
  )
}
