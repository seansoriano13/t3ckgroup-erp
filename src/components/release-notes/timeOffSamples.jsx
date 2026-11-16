import { useState } from "react"
import toast from "react-hot-toast"
import { Plus } from "lucide-react"
import { SampleAuthProvider } from "@/context/AuthContext"
import { Button } from "@/components/ui/button"
import { manilaDate, manilaToday, parseManilaDate } from "@/lib/manilaDate.js"
import CalendarMonth from "@/components/calendar/CalendarMonth"
import CalendarGantt from "@/components/calendar/CalendarGantt"
import DayRail from "@/components/calendar/DayRail"
import EntryDetail from "@/components/calendar/EntryDetail"
import { KindKey, LayoutSwitch, NavArrows } from "@/components/calendar/calendarParts.jsx"
import { DEFAULT_LAYERS, visibleEntries } from "@/components/calendar/entryKinds.jsx"
import { withSpan } from "@/components/calendar/entrySpan.js"
import { ganttDays, layoutTitle, shiftDate } from "@/components/calendar/calendarNav.js"
import ApplyLeaveModal from "../offsets/ApplyLeaveModal"
import SampleProvider from "./SampleProvider"
import { PEOPLE } from "./sampleData"

/**
 * The Time Off & Calendar tab's samples: the app's own components fed Sample
 * Data. The Calendar's parts are drawn here without the Calendar page itself,
 * which reads live entries and listens for meeting changes.
 * Throwaway (ADR 0030, 2026-11 amendment): if one breaks, delete it.
 */

// Signed in as a made-up employee, so nothing on these screens is the viewer's own.
const VIEWER = { id: "sample-viewer", name: "Sample Viewer", department: "SALES" }

const BOOKING_NOTE = "In the app, this opens a Meeting Request for that Venue and time. Nothing is booked here."

// Manila has no daylight saving, so a day is always 24 hours.
const addDays = (ymd, n) => manilaDate(new Date(parseManilaDate(ymd).getTime() + n * 86400000))
const at = (ymd, hhmm) => `${ymd}T${hhmm}:00+08:00`
const who = (p) => ({ id: p.id, name: p.name, department: p.department })

const VENUES = [
  { id: "v-conf", name: "Conference Room" },
  { id: "v-admin", name: "Admin Office" },
]

function timeOff(kind, person, startYmd, days, group) {
  return Array.from({ length: days }, (_, i) => {
    const ymd = addDays(startYmd, i)
    return {
      kind,
      id: `${group}-${i}`,
      group_id: group,
      manila_date: ymd,
      status: "APPROVED",
      employee: who(person),
      starts_at: at(ymd, "07:30"),
      ends_at: at(ymd, "18:00"),
      all_day: true,
      hours: 8,
      details: {},
    }
  })
}

function meeting(id, ymd, from, to, venue, title, by, participants) {
  return {
    kind: "MEETING",
    id,
    group_id: null,
    manila_date: ymd,
    status: "APPROVED",
    employee: who(by),
    starts_at: at(ymd, from),
    ends_at: at(ymd, to),
    all_day: false,
    venue,
    title,
    details: {
      purpose: title,
      meeting_type: "ONSITE",
      venue,
      stage: "APPROVED",
      facilitator: { name: by.name },
      participants: participants.map((p) => ({ name: p.name })),
      guests: [],
    },
  }
}

function sampleEntries(today) {
  return [
    ...timeOff("SIL", PEOPLE.paolo, addDays(today, 1), 3, "g-paolo"),
    ...timeOff("OFFSET", PEOPLE.joy, today, 1, "g-joy"),
    ...timeOff("LWOP", PEOPLE.mark, addDays(today, 6), 1, "g-mark"),
    ...timeOff("SIL", PEOPLE.nina, addDays(today, 9), 2, "g-nina"),
    {
      kind: "OVERTIME",
      id: "ot-carlo",
      group_id: "ot-carlo",
      manila_date: today,
      status: "APPROVED",
      employee: who(PEOPLE.carlo),
      starts_at: at(today, "18:00"),
      ends_at: at(today, "21:00"),
      all_day: false,
      hours: 3,
      details: {},
    },
    meeting("m-1", today, "09:00", "10:00", "Conference Room", "Demo bid kickoff", PEOPLE.lara, [PEOPLE.paolo, PEOPLE.joy]),
    meeting("m-2", today, "14:00", "15:30", "Admin Office", "Supplier call: Demo Radios", PEOPLE.joy, [PEOPLE.carlo]),
    meeting("m-3", addDays(today, 2), "10:00", "11:00", "Conference Room", "Demo City Hall site visit plan", PEOPLE.mark, [PEOPLE.lara]),
  ]
}

function useSampleCalendar() {
  const [today] = useState(() => manilaToday())
  const [entries] = useState(() => visibleEntries(sampleEntries(today), DEFAULT_LAYERS))
  const [selected, setSelected] = useState(null)
  return {
    today,
    entries,
    open: (e) => setSelected(withSpan(e, entries)),
    detail: <EntryDetail entry={selected} onClose={() => setSelected(null)} entries={entries} viewerId={VIEWER.id} />,
  }
}

const pickSlot = () => toast(BOOKING_NOTE, { id: "sample-booking" })

export function CalendarSample() {
  const { today, entries, open, detail } = useSampleCalendar()
  const [layout, setLayout] = useState("calendar")
  const [anchor, setAnchor] = useState(today)
  const weeks = 2
  const gantt = layout === "gantt"
  return (
    <SampleAuthProvider user={VIEWER}>
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <LayoutSwitch layout={layout} onChange={setLayout} />
          <h2 className="min-w-40 text-xl font-black tracking-tight">{layoutTitle(layout, anchor, weeks)}</h2>
          <NavArrows
            unit={gantt ? "week" : "month"}
            onPrev={() => setAnchor(shiftDate(layout, anchor, -1))}
            onNext={() => setAnchor(shiftDate(layout, anchor, 1))}
            onToday={() => setAnchor(today)}
          />
        </div>
        {gantt ? (
          <CalendarGantt
            days={ganttDays(anchor, weeks)}
            entries={entries}
            layers={DEFAULT_LAYERS}
            venues={VENUES}
            todayYmd={today}
            selectedYmd={anchor}
            onOpenEntry={open}
            onPickSlot={pickSlot}
          />
        ) : (
          <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
            <CalendarMonth
              anchor={anchor}
              entries={entries}
              todayYmd={today}
              selectedYmd={anchor}
              onSelectDay={setAnchor}
              onOpenEntry={open}
              loading={null}
            />
            <DayRail ymd={anchor} entries={entries} layers={DEFAULT_LAYERS} venues={VENUES} todayYmd={today} onOpenEntry={open} onPickSlot={pickSlot} />
          </div>
        )}
        <KindKey />
      </div>
      {detail}
    </SampleAuthProvider>
  )
}

export function MeetingRequestSample() {
  const { today, entries, open, detail } = useSampleCalendar()
  return (
    <SampleAuthProvider user={VIEWER}>
      <div className="max-w-sm">
        <DayRail ymd={today} entries={entries} layers={DEFAULT_LAYERS} venues={VENUES} todayYmd={today} onOpenEntry={open} onPickSlot={pickSlot} />
      </div>
      {detail}
    </SampleAuthProvider>
  )
}

// Signed in as Lara for the form, so it reads her department and balances,
// never the viewer's own.
const APPLICANT = { ...PEOPLE.lara, offset_hours_balance: 12, sil_hours_balance: 40 }

const LEAVE_CATEGORIES = [
  { id: "c-vacation", label: "Vacation Leave" },
  { id: "c-sick", label: "Sick Leave" },
  { id: "c-emergency", label: "Emergency Leave" },
]

const HEADS = [
  { ...PEOPLE.carlo, isHead: true },
  { ...PEOPLE.mark, isHead: true },
]

export function LeaveRangeSample() {
  const [open, setOpen] = useState(false)
  return (
    <SampleProvider
      seed={[
        [["activeLeaveCategories"], LEAVE_CATEGORIES],
        [["departmentHeads"], HEADS],
        [["pendingOffsetHours", APPLICANT.id], 0],
        [["pendingSilHours", APPLICANT.id], 0],
      ]}
    >
      <SampleAuthProvider user={APPLICANT}>
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">Open the form, pick Leave, then a date range over a weekend.</p>
          <Button type="button" onClick={() => setOpen(true)}>
            <Plus size={16} />
            File Time Off / Overtime
          </Button>
        </div>
        <ApplyLeaveModal isOpen={open} onClose={() => setOpen(false)} onSuccess={() => {}} />
      </SampleAuthProvider>
    </SampleProvider>
  )
}
