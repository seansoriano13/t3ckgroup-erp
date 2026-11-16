import { useMemo, useRef, useState } from "react"
import { ArrowDown, ArrowUp, Check, Copy, Reply, Trash2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { FieldBox } from "@/components/ui/FieldBox"
import { Input } from "@/components/ui/input"
import { SelectField } from "@/components/ui/SelectField"
import { Switch } from "@/components/ui/switch"
import TabGroup from "@/components/ui/TabGroup"
import { TablePager } from "@/components/ui/TablePager"
import { cn } from "@/lib/utils"
import { usePaging } from "../../hooks/usePaging"
import StatusBadge from "../StatusBadge"
import { Lines, MockWindow } from "./motion"
import { PEOPLE } from "./sampleData"

/**
 * Small demos for the October–November features that had no sample: each shows the rule the item
 * describes, with made-up data in local state only. Nothing here reads or writes a record.
 * Throwaway (ADR 0030, 2026-11 amendment).
 */

const DAY = 86400000
const shortDate = (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })

function Note({ children }) {
  return (
    <p className="text-sm text-muted-foreground" aria-live="polite">
      {children}
    </p>
  )
}

/* ------------------------------------------------------------------ SORs: Date of Award, PDI and Delivery */

export function AwardDatesDemo() {
  const [award, setAward] = useState("")
  const [pdi, setPdi] = useState("")
  const [delivery, setDelivery] = useState("")
  return (
    <div className="max-w-xl space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-muted-foreground">SOR-0412</span>
        <span className="text-sm font-semibold">Demo radio network</span>
        {award && (
          <span className="animate-success-pop">
            <StatusBadge label="Awarded" theme="green" />
          </span>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Input label="Date of Award" type="date" value={award} onChange={(e) => setAward(e.target.value)} />
        <Input label="Date of PDI" type="date" value={pdi} onChange={(e) => setPdi(e.target.value)} />
        <Input label="Date of Delivery" type="date" value={delivery} onChange={(e) => setDelivery(e.target.value)} />
      </div>
      <Note>{award ? "Awarded. The people buying for this SOR were told." : "Fill in the Date of Award and watch the SOR."}</Note>
    </div>
  )
}

/* ------------------------------------------------------------------ Tasks: Reopen a Group Task that is On hold */

export function ReopenDemo() {
  const [start] = useState(() => Date.now())
  const [status, setStatus] = useState("In progress")
  const [held, setHeld] = useState(0)
  const [shift, setShift] = useState(0)
  const due = new Date(start + (10 + shift) * DAY)
  const onHold = status === "On hold"
  return (
    <div className="max-w-xl space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">Demo site survey · Group Task</div>
          <div className="text-xs text-muted-foreground">Made by the Stage Technical Review of SOR-0412</div>
        </div>
        <StatusBadge label={status} theme={onHold ? "amber" : "blue"} />
      </div>
      <div className="flex items-baseline gap-2 text-sm">
        <span className="text-muted-foreground">Due Date</span>
        <span key={shift} className="animate-content-in font-semibold">{shortDate(due)}</span>
        {onHold && <span className="text-xs text-muted-foreground">· on hold {held} {held === 1 ? "day" : "days"}</span>}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" disabled={onHold} onClick={() => { setStatus("On hold"); setHeld(0) }}>
          The SOR leaves that Stage
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={!onHold} onClick={() => setHeld((d) => d + 1)}>
          A day passes
        </Button>
        <Button type="button" variant="primary" size="sm" disabled={!onHold} onClick={() => { setStatus("In progress"); setShift((s) => s + held) }}>
          Reopen
        </Button>
      </div>
      <Note>
        {onHold
          ? "On hold. Its creator, a Super Admin or a head of the creator's department can press Reopen."
          : shift > 0
            ? `Back to In progress, and the Due Date moved out by ${shift} ${shift === 1 ? "day" : "days"}, the time it was on hold.`
            : "Move the SOR on, let a few days pass, then Reopen."}
      </Note>
    </div>
  )
}

/* ------------------------------------------------------------------ Tasks: add a whole Team or Employee Group */

const PICKS = [
  { key: "one", label: `One person: ${PEOPLE.paolo.name}`, people: [PEOPLE.paolo.name] },
  { key: "team", label: "Team: Demo Install Crew", people: [PEOPLE.carlo.name, PEOPLE.joy.name, PEOPLE.mark.name] },
  { key: "group", label: "Employee Group: Demo Night Shift", people: [PEOPLE.nina.name, PEOPLE.carlo.name] },
]

export function TeamPickDemo() {
  const [members, setMembers] = useState([])
  const add = (people) => setMembers((m) => [...m, ...people.filter((p) => !m.includes(p))])
  return (
    <div className="max-w-xl space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="text-sm font-semibold">Members of a new Group Task</div>
      <div className="flex flex-wrap gap-2">
        {PICKS.map((pick) => (
          <Button key={pick.key} type="button" variant="outline" size="sm" onClick={() => add(pick.people)}>
            {pick.label}
          </Button>
        ))}
        <Button type="button" variant="ghost" size="sm" onClick={() => setMembers([])} disabled={members.length === 0}>
          Clear
        </Button>
      </div>
      <ul className="flex min-h-8 flex-wrap gap-1.5">
        {members.map((name) => (
          <li key={name} className="animate-success-pop rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-medium">
            {name}
          </li>
        ))}
      </ul>
      <Note>{members.length ? `${members.length} members. Someone already in the list is not added twice.` : "Add one person, then a whole Team at once."}</Note>
    </div>
  )
}

/* ------------------------------------------------------------------ Time Off: the lunch hour comes off by the clock */

const SHIFTS = [
  { value: "am", label: "7:00 – 12:00", from: 7, to: 12 },
  { value: "pm", label: "13:00 – 18:00", from: 13, to: 18 },
  { value: "day", label: "8:00 – 17:00", from: 8, to: 17 },
  { value: "ot", label: "Overtime 18:00 – 23:00", from: 18, to: 23 },
]

export function MealBreakDemo() {
  const [pick, setPick] = useState("am")
  const shift = SHIFTS.find((s) => s.value === pick)
  const span = shift.to - shift.from
  const covers = shift.from <= 12 && shift.to >= 13
  const oldHours = span >= 5 ? span - 1 : span
  const newHours = covers ? span - 1 : span
  const hours = (n) => `${n} ${n === 1 ? "hour" : "hours"}`
  return (
    <div className="max-w-xl space-y-3">
      <TabGroup tabs={SHIFTS.map(({ value, label }) => ({ value, label }))} activeTab={pick} onChange={setPick} size="sm" />
      <div className="relative h-8 rounded-lg bg-mauve-3">
        <div className="absolute inset-y-0 rounded-lg bg-mauve-7 transition-all duration-500 ease-out-expo" style={{ left: `${((shift.from - 6) / 18) * 100}%`, width: `${(span / 18) * 100}%` }} />
        <div className="absolute inset-y-0 border-x border-dashed border-amber-9 bg-amber-a4" style={{ left: `${(6 / 18) * 100}%`, width: `${(1 / 18) * 100}%` }} title="Meal Break, 12 to 1 pm" />
        <span className="absolute -bottom-5 text-[10px] text-muted-foreground" style={{ left: `${(6 / 18) * 100}%` }}>12–1</span>
      </div>
      <div className="grid gap-3 pt-3 sm:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-3">
          <div className="text-xs text-muted-foreground">The old rule: an hour off any day of 5 hours or more</div>
          <div className="mt-1 font-mono text-lg font-bold">{hours(oldHours)}</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-3">
          <div className="text-xs text-muted-foreground">Now: an hour off only when 12 to 1 is inside your hours</div>
          <div key={pick} className="animate-content-in mt-1 font-mono text-lg font-bold">{hours(newHours)}</div>
        </div>
      </div>
      <Note>{oldHours === newHours ? "Both rules agree here." : `The old rule took an hour you worked: ${hours(span)} on the clock counted as ${hours(oldHours)}.`}</Note>
    </div>
  )
}

/* ------------------------------------------------------------------ Time Off: HR keeps the list of Venues */

export function VenuesDemo() {
  const [venues, setVenues] = useState([
    { id: 1, name: "Demo Board Room", shown: true },
    { id: 2, name: "Demo Training Room", shown: true },
    { id: 3, name: "Demo Pantry", shown: false },
  ])
  const [draft, setDraft] = useState("")
  const nextId = useRef(4)
  const move = (i, by) =>
    setVenues((list) => {
      const next = [...list]
      ;[next[i], next[i + by]] = [next[i + by], next[i]]
      return next
    })
  const patch = (id, fields) => setVenues((list) => list.map((v) => (v.id === id ? { ...v, ...fields } : v)))
  return (
    <div className="max-w-xl space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="text-label font-bold tracking-wider text-muted-foreground uppercase">Settings · Venues</div>
      <ul className="space-y-1.5">
        {venues.map((v, i) => (
          <li key={v.id} className={cn("flex items-center gap-2 rounded-lg border border-border px-2 py-1.5", !v.shown && "opacity-60")}>
            <Input aria-label={`Name of ${v.name}`} value={v.name} onChange={(e) => patch(v.id, { name: e.target.value })} className="h-8 flex-1" />
            <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move ${v.name} up`} disabled={i === 0} onClick={() => move(i, -1)}>
              <ArrowUp />
            </Button>
            <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move ${v.name} down`} disabled={i === venues.length - 1} onClick={() => move(i, 1)}>
              <ArrowDown />
            </Button>
            <Switch aria-label={`${v.name} can be booked`} checked={v.shown} onCheckedChange={(shown) => patch(v.id, { shown })} />
            <Button type="button" variant="ghost" size="icon-sm" aria-label={`Delete ${v.name}`} onClick={() => setVenues((list) => list.filter((x) => x.id !== v.id))}>
              <Trash2 />
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Input aria-label="New Venue" placeholder="New Venue" value={draft} onChange={(e) => setDraft(e.target.value)} className="h-8 flex-1" />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!draft.trim()}
          onClick={() => {
            setVenues((list) => [...list, { id: nextId.current++, name: draft.trim(), shown: true }])
            setDraft("")
          }}
        >
          Add
        </Button>
      </div>
      <Note>{venues.filter((v) => v.shown).length} of {venues.length} Venues can be booked. A hidden one stays in the list but is not offered.</Note>
    </div>
  )
}

/* ------------------------------------------------------------------ Everywhere: a link opens the exact window */

const RECORDS = [
  { key: "sor", address: "sor:SOR-0412", label: "SOR-0412 · Demo radio network" },
  { key: "task", address: "task:T-2207", label: "Task · Demo site survey" },
  { key: "group-task", address: "group-task:GT-0318", label: "Group Task · Demo kickoff" },
]

export function LinkDemo() {
  const [open, setOpen] = useState(null)
  const record = RECORDS.find((r) => r.key === open)
  return (
    <div className="max-w-2xl space-y-3">
      <MockWindow address={`t3ckgroup-erp.online/tasks${record ? `?open=${record.address}` : ""}`}>
        <div className="relative min-h-48">
          <ul className="space-y-1.5">
            {RECORDS.map((r) => (
              <li key={r.key}>
                <Button type="button" variant="ghost" size="sm" className="w-full justify-start" onClick={() => setOpen(r.key)}>
                  {r.label}
                </Button>
              </li>
            ))}
          </ul>
          {record && (
            <div className="animate-content-in absolute inset-1 space-y-2 rounded-xl border border-border bg-card p-3 shadow-lg">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">{record.label}</span>
                <Button type="button" variant="ghost" size="icon-sm" aria-label="Close" onClick={() => setOpen(null)}>
                  <X />
                </Button>
              </div>
              <Lines n={3} />
            </div>
          )}
        </div>
      </MockWindow>
      <Note>{record ? "The address now points at this window. Send it, and it opens the same window for the other person." : "Open one of the three, and watch the address."}</Note>
    </div>
  )
}

/* ------------------------------------------------------------------ Everywhere: unsend, react, reply and copy */

export function ChatActionsDemo() {
  const [messages, setMessages] = useState(() => [
    { id: 1, me: false, who: PEOPLE.lara.name, text: "Can you send the brochure for the base station?", reactions: [] },
    { id: 2, me: true, who: "You", text: "Sending it now.", reactions: [] },
  ])
  const [reply, setReply] = useState(null)
  const [draft, setDraft] = useState("")
  const [note, setNote] = useState("Hover a message for its actions. Enter sends.")
  const nextId = useRef(3)
  const patch = (id, fields) => setMessages((list) => list.map((m) => (m.id === id ? { ...m, ...fields } : m)))
  const send = () => {
    if (!draft.trim()) return
    setMessages((list) => [...list, { id: nextId.current++, me: true, who: "You", text: draft.trim(), replyTo: reply?.text, reactions: [] }])
    setDraft("")
    setReply(null)
  }
  return (
    <div className="max-w-xl space-y-3 rounded-xl border border-border bg-card p-3">
      <ul className="space-y-2">
        {messages.map((m) => (
          <li key={m.id} className={cn("group flex flex-col gap-1", m.me ? "items-end" : "items-start")}>
            <div className={cn("max-w-[85%] rounded-xl px-3 py-2 text-sm", m.me ? "bg-mauve-4" : "bg-muted", m.gone && "italic text-muted-foreground")}>
              {m.replyTo && <div className="mb-1 border-l-2 border-mauve-8 pl-2 text-xs text-muted-foreground">{m.replyTo}</div>}
              {m.gone ? "You unsent a message" : m.text}
              {m.reactions.length > 0 && <span className="ml-2">{m.reactions.join("")}</span>}
            </div>
            {!m.gone && (
              <div className="flex gap-0.5 opacity-60 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                <Button type="button" variant="ghost" size="xs" onClick={() => patch(m.id, { reactions: [...m.reactions, "👍"] })}>
                  👍
                </Button>
                <Button type="button" variant="ghost" size="xs" onClick={() => setReply(m)}>
                  <Reply /> Reply
                </Button>
                <Button type="button" variant="ghost" size="xs" onClick={() => setNote("Copied. The text is ready to paste.")}>
                  <Copy /> Copy
                </Button>
                {m.me && (
                  <Button type="button" variant="ghost" size="xs" onClick={() => { patch(m.id, { gone: true }); setNote("Unsent. You can do this up to 15 minutes after sending.") }}>
                    Unsend
                  </Button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      {reply && (
        <div className="flex items-center justify-between rounded-lg bg-muted px-3 py-1.5 text-xs">
          <span className="truncate">Replying to: {reply.text}</span>
          <Button type="button" variant="ghost" size="icon-xs" aria-label="Cancel the reply" onClick={() => setReply(null)}>
            <X />
          </Button>
        </div>
      )}
      <Input
        aria-label="Message"
        placeholder="Write a message, then press Enter"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            send()
          }
        }}
      />
      <Note>{note}</Note>
    </div>
  )
}

/* ------------------------------------------------------------------ Everywhere: make a table column wider */

const WIDTHS = [160, 220, 120]
const COLS = ["SOR", "Project", "Stage"]
const ROWS = [
  ["SOR-0412", "Demo radio network for the city hall", "Bid Submitted"],
  ["SOR-0415", "Demo clinic repeaters", "Technical Review"],
]

export function ResizeDemo() {
  const [widths, setWidths] = useState(WIDTHS)
  const drag = useRef(null)
  const setWidth = (i, w) => setWidths((list) => list.map((x, j) => (j === i ? Math.max(70, Math.min(420, w)) : x)))
  const template = widths.map((w) => `${w}px`).join(" ")
  return (
    <div className="max-w-2xl space-y-3">
      <div className="overflow-x-auto rounded-xl border border-border bg-card text-sm">
        <div className="grid border-b border-border bg-muted" style={{ gridTemplateColumns: template }}>
          {COLS.map((col, i) => (
            <div key={col} className="relative px-3 py-2 text-label font-bold tracking-wider text-muted-foreground uppercase">
              {col}
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label={`Resize ${col}`}
                aria-valuenow={widths[i]}
                tabIndex={0}
                className="absolute inset-y-1 right-0 w-1.5 cursor-col-resize rounded bg-mauve-6 hover:bg-mauve-9 focus-visible:bg-mauve-11"
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId)
                  drag.current = { i, x: e.clientX, w: widths[i] }
                }}
                onPointerMove={(e) => {
                  if (drag.current?.i === i) setWidth(i, drag.current.w + e.clientX - drag.current.x)
                }}
                onPointerUp={() => {
                  drag.current = null
                }}
                onDoubleClick={() => setWidth(i, WIDTHS[i])}
                onKeyDown={(e) => {
                  if (e.key === "ArrowRight") setWidth(i, widths[i] + 20)
                  if (e.key === "ArrowLeft") setWidth(i, widths[i] - 20)
                }}
              />
            </div>
          ))}
        </div>
        {ROWS.map((row) => (
          <div key={row[0]} className="grid border-b border-border last:border-b-0" style={{ gridTemplateColumns: template }}>
            {row.map((cell) => (
              <div key={cell} className="truncate px-3 py-2">{cell}</div>
            ))}
          </div>
        ))}
      </div>
      <Note>Drag a heading's right edge. Double-click it to put the width back. In the app your widths are remembered.</Note>
    </div>
  )
}

/* ------------------------------------------------------------------ Everywhere: everything works with the keyboard */

export function KeyboardDemo() {
  const [last, setLast] = useState("Click Open first, then press Tab, Enter or Space.")
  const [on, setOn] = useState(false)
  const said = (what) => () => setLast(`You used: ${what}`)
  return (
    <div className="max-w-xl space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={said("Open")}>Open</Button>
        <Button type="button" variant="outline" size="sm" onClick={said("the filter pill Mine")}>Mine</Button>
        <Button type="button" variant="outline" size="sm" onClick={said("the filter pill Overdue")}>Overdue</Button>
      </div>
      <Button type="button" variant="ghost" className="h-auto w-full justify-start rounded-lg border border-border px-3 py-2 text-left" onClick={said("the row SOR-0412")}>
        SOR-0412 · Demo radio network
      </Button>
      <FieldBox inline className="text-sm">
        <Switch checked={on} onCheckedChange={(v) => { setOn(v); setLast(`You used: the switch, now ${v ? "on" : "off"}`) }} />
        Show closed SORs
      </FieldBox>
      <Note>{last}</Note>
    </div>
  )
}

/* ------------------------------------------------------------------ Everywhere: long lists come a page at a time */

const SORS = Array.from({ length: 73 }, (_, i) => `SOR-${String(400 + i).padStart(4, "0")} · Demo project ${i + 1}`)

export function PagesDemo() {
  const paging = usePaging(SORS, { initialPageSize: 10 })
  return (
    <div className="max-w-xl overflow-hidden rounded-xl border border-border bg-card">
      <ul className="divide-y divide-border">
        {paging.rows.map((row) => (
          <li key={row} className="px-4 py-2 text-sm">{row}</li>
        ))}
      </ul>
      <TablePager {...paging} noun="SORs" />
    </div>
  )
}

/* ------------------------------------------------------------------ For admins: a Stage can move on by itself */

const CONDITIONS = ["Bid documents uploaded", "Bid amount filled in", "Bid submitted to the client"]

export function AutoAdvanceDemo() {
  const [auto, setAuto] = useState(true)
  const [done, setDone] = useState([])
  const all = done.length === CONDITIONS.length
  const moved = auto && all
  return (
    <div className="max-w-xl space-y-3 rounded-xl border border-border bg-card p-4">
      <FieldBox inline className="text-sm font-medium">
        <Switch checked={auto} onCheckedChange={setAuto} />
        Move the SOR on when the last condition is met
      </FieldBox>
      <div className="flex items-center gap-2 text-sm">
        <StatusBadge label="Bid Submitted" theme={moved ? "mauve" : "blue"} />
        <span className={cn("text-muted-foreground transition-opacity", moved ? "opacity-100" : "opacity-30")}>→</span>
        <span className={cn("transition-all duration-500", moved ? "opacity-100" : "opacity-30")}>
          <StatusBadge label="Awarded" theme="green" />
        </span>
      </div>
      <ul className="space-y-1.5">
        {CONDITIONS.map((c) => (
          <li key={c}>
            <FieldBox inline className="text-sm">
              <Checkbox checked={done.includes(c)} onCheckedChange={(v) => setDone((d) => (v ? [...d, c] : d.filter((x) => x !== c)))} />
              {c}
            </FieldBox>
          </li>
        ))}
      </ul>
      <Note>{moved ? "The last condition was met, so the SOR moved on by itself." : all ? "Clear to move. With the switch off, someone moves it by hand." : "Tick the conditions one by one."}</Note>
    </div>
  )
}

/* ------------------------------------------------------------------ Purchasing: statuses on a Purchase Request */

const STATUSES = ["Available", "To purchase", "Still canvassing", "Purchased", "Received", "Cannot source", "Cancelled"]
const STATUS_THEME = { Available: "green", "To purchase": "blue", "Still canvassing": "violet", Purchased: "blue", Received: "green", "Cannot source": "red", Cancelled: "mauve" }
const START_LINES = [
  { id: 1, name: "Demo handheld radio", qty: "10 pc", status: "To purchase" },
  { id: 2, name: "Demo base station", qty: "1 set", status: "To purchase" },
  { id: 3, name: "Demo antenna kit", qty: "1 set", status: "Available" },
  { id: 4, name: "Demo coaxial cable", qty: "50 m", status: "Still canvassing" },
]

export function PurchaseRequestDemo() {
  const [lines, setLines] = useState(START_LINES)
  const [ticked, setTicked] = useState([])
  const [undo, setUndo] = useState(null)
  const timer = useRef(null)
  const apply = (status) => {
    if (!status || ticked.length === 0) return
    const before = lines
    setLines((list) => list.map((l) => (ticked.includes(l.id) ? { ...l, status } : l)))
    setUndo({ before, text: `${ticked.length} set to ${status}.` })
    setTicked([])
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setUndo(null), 6000)
  }
  return (
    <div className="max-w-2xl space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold">
          <span className="font-mono text-muted-foreground">PR_0042</span> · Demo radio network
        </div>
        <div className="w-48">
          <SelectField options={STATUSES.map((s) => ({ value: s, label: s }))} value={null} onChange={apply} placeholder={`Set ${ticked.length || "ticked"} to…`} disabled={ticked.length === 0} />
        </div>
      </div>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {lines.map((l) => (
          <li key={l.id} className="flex items-center gap-3 px-3 py-2 text-sm">
            <Checkbox aria-label={`Tick ${l.name}`} checked={ticked.includes(l.id)} onCheckedChange={(v) => setTicked((t) => (v ? [...t, l.id] : t.filter((x) => x !== l.id)))} />
            <span className="min-w-0 flex-1 truncate">{l.name}</span>
            <span className="text-xs text-muted-foreground">{l.qty}</span>
            <span key={l.status} className="animate-content-in">
              <StatusBadge label={l.status} theme={STATUS_THEME[l.status]} />
            </span>
          </li>
        ))}
      </ul>
      <div className="flex min-h-8 items-center gap-2">
        {undo ? (
          <>
            <span className="text-sm">{undo.text}</span>
            <Button type="button" variant="outline" size="sm" onClick={() => { setLines(undo.before); setUndo(null) }}>
              Undo
            </Button>
          </>
        ) : (
          <Note>Tick a few lines, then set their status in one go. Undo shows for a few seconds after.</Note>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ Purchasing: the Technical page */

const PRODUCTS = ["Demo handheld radio", "Demo base station", "Demo antenna kit"]

export function TechnicalDemo() {
  const [verdicts, setVerdicts] = useState({})
  const [ticked, setTicked] = useState([])
  const set = (names, verdict) => setVerdicts((v) => ({ ...v, ...Object.fromEntries(names.map((n) => [n, verdict])) }))
  const judged = PRODUCTS.filter((p) => verdicts[p]).length
  return (
    <div className="max-w-2xl space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="font-semibold">SOR-0412 · Technical</span>
        <span className="text-muted-foreground">{judged} of {PRODUCTS.length} judged · no prices shown</span>
      </div>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {PRODUCTS.map((p) => (
          <li key={p} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
            <Checkbox aria-label={`Tick ${p}`} checked={ticked.includes(p)} onCheckedChange={(v) => setTicked((t) => (v ? [...t, p] : t.filter((x) => x !== p)))} />
            <span className="min-w-0 flex-1">{p}</span>
            {["Complies", "Deviates"].map((verdict) => (
              <Button key={verdict} type="button" size="xs" variant={verdicts[p] === verdict ? "default" : "outline"} aria-pressed={verdicts[p] === verdict} onClick={() => set([p], verdict)}>
                {verdict === "Complies" ? <Check /> : <X />} {verdict}
              </Button>
            ))}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" disabled={ticked.length === 0} onClick={() => { set(ticked, "Complies"); setTicked([]) }}>
          Mark {ticked.length || ""} ticked Complies
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={ticked.length === 0} onClick={() => { set(ticked, "Deviates"); setTicked([]) }}>
          Mark {ticked.length || ""} ticked Deviates
        </Button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ Purchasing: a Canvass of up to three offers */

const RATE = 56.5
const OFFERS = [
  { id: "a", supplier: "Demo Rescue Supply Co.", price: 18000, currency: "PHP", lead: "14 days" },
  { id: "b", supplier: "Demo Medical Traders", price: 17500, currency: "PHP", lead: "10 days" },
  { id: "c", supplier: "Demo Hong Kong Ltd.", price: 300, currency: "USD", lead: "45 days" },
]
const peso = (n) => `₱${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function CanvassOffersDemo() {
  const [pick, setPick] = useState(null)
  const [reason, setReason] = useState("")
  const [winner, setWinner] = useState(null)
  const offers = useMemo(() => OFFERS.map((o) => ({ ...o, php: o.currency === "USD" ? o.price * RATE : o.price })), [])
  return (
    <div className="max-w-2xl space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="text-sm font-semibold">Canvass · Demo folding stretcher</div>
      <ul className="grid gap-2 sm:grid-cols-3">
        {offers.map((o) => (
          <li key={o.id} className={cn("space-y-1 rounded-lg border p-3 text-sm transition-colors", winner === o.id ? "border-green-7 bg-green-a2" : pick === o.id ? "border-mauve-11" : "border-border")}>
            <div className="font-semibold">{o.supplier}</div>
            <div className="font-mono">{o.currency === "USD" ? `$${o.price.toFixed(2)}` : peso(o.price)}</div>
            {o.currency === "USD" && <div className="text-xs text-muted-foreground">{peso(o.php)} at the day's rate, ₱{RATE} (sample)</div>}
            <div className="text-xs text-muted-foreground">Lead time {o.lead}</div>
            <Button type="button" variant={pick === o.id ? "default" : "outline"} size="xs" onClick={() => { setPick(o.id); setWinner(null) }}>
              {winner === o.id ? "Winner" : "Pick"}
            </Button>
          </li>
        ))}
      </ul>
      {pick && !winner && (
        <div className="flex gap-2">
          <Input aria-label="Why this supplier" placeholder="Why this supplier?" value={reason} onChange={(e) => setReason(e.target.value)} className="h-8 flex-1" />
          <Button type="button" variant="primary" size="sm" disabled={!reason.trim()} onClick={() => setWinner(pick)}>
            Pick the winner
          </Button>
        </div>
      )}
      <Note>
        {winner
          ? `Winner picked: ${OFFERS.find((o) => o.id === winner).supplier}. Reason: ${reason}. On an S0 Evaluation line, the winner fills in the cost.`
          : "Pick an offer, then say why. A winner needs a reason."}
      </Note>
    </div>
  )
}
