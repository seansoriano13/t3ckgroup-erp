import { useState } from "react"
import { Printer } from "lucide-react"
import toast from "react-hot-toast"
import TabGroup from "@/components/ui/TabGroup"
import { Checkbox } from "@/components/ui/checkbox"
import { FieldBox } from "@/components/ui/FieldBox"
import Avatar from "../Avatar"
import WhoIsOut from "../../pages/hr/offsets/_components/WhoIsOut"
import PendingList from "../../pages/hr/offsets/_components/PendingList"
import HistoryView from "../../pages/hr/offsets/_components/HistoryView"
import CalendarTab from "../../pages/hr/offsets/_components/CalendarTab"
import BalancesTable from "../../pages/hr/offsets/_components/BalancesTable"
import LeaveSheet from "../../pages/hr/offsets/_components/LeaveSheet"
import ProfileSheet from "../../pages/hr/offsets/_components/ProfileSheet"
import { LEAVE_VIEWS, TYPE_META, recordKey } from "../../pages/hr/offsets/_components/leaveDisplay"
import { formatRecordDate } from "../../pages/hr/offsets/_components/useDocumentCenter"
import SampleProvider, { SAMPLE_SAVE_BLOCKED } from "./SampleProvider"
import { PEOPLE, daysAgo, hoursAgo, isoDate } from "./sampleData"

/**
 * The Leaves Manager as its own real views fed Sample Data (ADR 0030): every
 * tab is filled and a request or a person opens the real side panel. Kept in
 * its own file. The panel's open state is local, not `?record=`, so opening
 * one never touches this page's address. The Document Center is drawn here
 * rather than mounted: the real one reads and writes the HR user's saved
 * print tray, and Sample Data must never touch that.
 */

const refuse = () => toast(SAMPLE_SAVE_BLOCKED)
const noop = () => {}

const company = { name: "Demo Trading Co." }
const person = (p, extra = {}) => ({
  ...p,
  company,
  offset_hours_balance: 16,
  sil_hours_balance: 40,
  undertime_this_month: 0,
  ...extra,
})

const EMPLOYEES = [
  person(PEOPLE.lara, { offset_hours_balance: 12, sil_hours_balance: 32 }),
  person(PEOPLE.paolo, { offset_hours_balance: 4, sil_hours_balance: 24, undertime_this_month: 1 }),
  person(PEOPLE.joy, { offset_hours_balance: 20, sil_hours_balance: 48 }),
  person(PEOPLE.carlo, { offset_hours_balance: 8, sil_hours_balance: 40 }),
  person(PEOPLE.nina, { offset_hours_balance: 0, sil_hours_balance: 16 }),
  person(PEOPLE.mark, { offset_hours_balance: 16, sil_hours_balance: 56 }),
]
const byId = Object.fromEntries(EMPLOYEES.map((e) => [e.id, e]))

const request = (id, who, type, status, extra) => ({
  id,
  employee_id: who.id,
  employee: byId[who.id],
  company,
  type,
  status,
  dayCount: 1,
  head_status: "APPROVED",
  ...extra,
})

const PENDING = [
  request("pl-1", PEOPLE.lara, "SIL", "PENDING", { date: isoDate(7), hours: 8, reason: "Family event in the province.", created_at: hoursAgo(5) }),
  request("pl-2", PEOPLE.carlo, "OFFSET", "PENDING", { date: isoDate(3), hours: 4, reason: "Half day to make up for Saturday's delivery.", created_at: daysAgo(2) }),
  request("pl-3", PEOPLE.paolo, "OVERTIME", "PENDING", { date: isoDate(-1), hours: 3, start_time: "17:00:00", end_time: "20:00:00", reason: "Finished the bid documents for Demo Province.", created_at: hoursAgo(20) }),
]

const DECIDED = [
  request("dl-1", PEOPLE.joy, "SIL", "APPROVED", { date: isoDate(-6), hours: 8, reason: "Medical check-up.", created_at: daysAgo(9), updated_at: daysAgo(8) }),
  request("dl-2", PEOPLE.mark, "OFFSET", "APPROVED_OFFSET", { date: isoDate(-3), hours: 4, reason: "Errands.", created_at: daysAgo(6), updated_at: daysAgo(5) }),
  request("dl-3", PEOPLE.nina, "OVERTIME", "APPROVED_PAID", { date: isoDate(-8), hours: 2, start_time: "18:00:00", end_time: "20:00:00", reason: "Payroll cut-off.", created_at: daysAgo(10), updated_at: daysAgo(8) }),
  request("dl-4", PEOPLE.paolo, "OFFSET", "REJECTED", { date: isoDate(-4), hours: 8, reason: "Personal day.", created_at: daysAgo(7), updated_at: daysAgo(5) }),
]

// Approved leave as one row per day, the way the calendar and Who's out read it.
const firstOfMonth = () => {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1)
}
const monthDay = (day) => {
  const d = firstOfMonth()
  d.setDate(day)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}
let n = 0
const day = (who, type, date, hours = 8) => ({
  id: `ap-${++n}`,
  employee_id: who.id,
  employee: byId[who.id],
  type,
  status: "APPROVED",
  date,
  hours,
  reason: "Approved leave.",
})

const APPROVED_DAYS = [
  day(PEOPLE.joy, "SIL", isoDate(0)),
  day(PEOPLE.mark, "OFFSET", isoDate(0), 4),
  day(PEOPLE.nina, "SIL", isoDate(1)),
  day(PEOPLE.lara, "SIL", monthDay(6)),
  day(PEOPLE.lara, "SIL", monthDay(7)),
  day(PEOPLE.carlo, "OFFSET", monthDay(10), 4),
  day(PEOPLE.joy, "SIL", monthDay(14)),
  day(PEOPLE.joy, "SIL", monthDay(15)),
  day(PEOPLE.mark, "SIL", monthDay(20)),
  day(PEOPLE.nina, "OFFSET", monthDay(22), 4),
  day(PEOPLE.paolo, "SIL", monthDay(24)),
]

const REQUESTS = [...PENDING, ...DECIDED]
const availableHoursFor = (r) => {
  const balance = r.type === "OFFSET" ? r.employee?.offset_hours_balance : r.type === "SIL" ? r.employee?.sil_hours_balance : null
  return balance == null ? null : balance - r.hours
}

function DocumentsPreview() {
  const [picked, setPicked] = useState([DECIDED[0].id])
  const approved = DECIDED.filter((r) => r.status !== "REJECTED")
  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
      <section className="flex min-w-0 flex-col gap-4">
        <h3 className="text-base font-black text-foreground">1 · Choose records</h3>
        <ul className="rounded-2xl border border-border bg-card p-2">
          {approved.map((r) => (
            <li key={recordKey(r)}>
              <FieldBox inline className={`gap-3 rounded-xl px-3 py-3 ${picked.includes(r.id) ? "bg-muted" : ""}`}>
                <Avatar name={r.employee.name} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold text-foreground">{r.employee.name}</span>
                  <span className="block truncate text-xs font-medium text-muted-foreground">
                    {TYPE_META[r.type].label} · {formatRecordDate(r)} · {r.hours} hrs
                  </span>
                </span>
                <Checkbox
                  aria-label={`Add ${r.employee.name}'s record to the tray`}
                  checked={picked.includes(r.id)}
                  onCheckedChange={() => toggle(r.id)}
                  className="size-5 rounded-full"
                />
              </FieldBox>
            </li>
          ))}
        </ul>
      </section>
      <section className="flex min-w-0 flex-col gap-4">
        <h3 className="text-base font-black text-foreground">2 · Set the order, then print</h3>
        <p className="text-xs font-bold tabular-nums text-foreground">
          {picked.length} {picked.length === 1 ? "form" : "forms"} queued · two slips share a sheet
        </p>
        <div className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border px-6 py-8 text-center text-sm font-medium text-muted-foreground">
          <Printer size={22} />
          The real Document Center previews each form exactly as it prints, and marks it printed.
        </div>
      </section>
    </div>
  )
}

export function LeavesManagerSample() {
  const [view, setView] = useState("pending")
  // { key, list }: the open request and the list its arrows step through.
  const [open, setOpen] = useState(null)
  const [personId, setPersonId] = useState(null)

  const list = open?.list ?? []
  const index = list.findIndex((r) => recordKey(r) === open?.key)
  const current = open ? REQUESTS.find((r) => recordKey(r) === open.key) ?? null : null
  const profile = EMPLOYEES.find((e) => e.id === personId) ?? null

  const openRequest = (r, from) => setOpen({ key: recordKey(r), list: from })
  const held = (type) => PENDING.filter((r) => r.employee_id === personId && r.type === type).reduce((s, r) => s + r.hours, 0)

  const changeView = (next) => {
    setOpen(null)
    setPersonId(null)
    setView(next)
  }

  let body
  if (view === "pending") {
    body = <PendingList rows={PENDING} total={PENDING.length} loading={false} availableHoursFor={availableHoursFor} asc onOpen={openRequest} />
  } else if (view === "calendar") {
    body = <CalendarTab approvedLeaves={APPROVED_DAYS} pendingLeaves={PENDING} monthStart={monthDay(1)} />
  } else if (view === "history") {
    body = <HistoryView rows={DECIDED} loading={false} onOpen={openRequest} />
  } else if (view === "documents") {
    body = <DocumentsPreview />
  } else {
    body = <BalancesTable employees={EMPLOYEES} pendingLeaves={PENDING} onOpenPerson={setPersonId} />
  }

  return (
    <SampleProvider>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-base font-bold text-foreground">Leaves Manager</p>
          <WhoIsOut approvedLeaves={APPROVED_DAYS} />
        </div>
        <TabGroup
          variant="underline"
          tabs={LEAVE_VIEWS.map((v) => (v.value === "pending" ? { ...v, badge: PENDING.length } : v))}
          activeTab={view}
          onChange={changeView}
        />
        <div className="overflow-x-auto">{body}</div>
      </div>
      <LeaveSheet
        record={current}
        crumb={current?.status === "PENDING" ? "Pending" : "Request History"}
        index={index}
        total={list.length}
        onStep={(delta) => {
          const to = list[index + delta]
          if (to) setOpen({ key: recordKey(to), list })
        }}
        onClose={() => setOpen(null)}
        actions={{ decide: refuse, undo: refuse, preview: noop }}
        availableHoursFor={availableHoursFor}
      />
      <ProfileSheet
        person={profile}
        held={held}
        pending={profile ? PENDING.filter((r) => r.employee_id === profile.id) : []}
        decided={profile ? DECIDED.filter((r) => r.employee_id === profile.id) : []}
        onClose={() => setPersonId(null)}
        onReview={(r, from) => {
          setPersonId(null)
          openRequest(r, from)
        }}
      />
    </SampleProvider>
  )
}
