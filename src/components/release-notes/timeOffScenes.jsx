import { useMemo, useState } from "react"
import { ChevronLeft, ChevronRight, Minus, Plus } from "lucide-react"
import toast from "react-hot-toast"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import HeadSelectField from "../offsets/HeadSelectField"
import { ENTRY_KINDS } from "../calendar/entryKinds"
import StatusBadge from "../StatusBadge"
import MiniForm from "./MiniForm"
import SampleProvider, { SAMPLE_SAVE_BLOCKED } from "./SampleProvider"
import { MockField } from "./motion"
import { useScene } from "./useScene"
import { PEOPLE } from "./sampleData"

/**
 * The Time Off & HR tab: two demos (Available and After this, Still pending) and the Before and
 * After scenes of its fixes. The Department Head box is the real one, fed Sample Data.
 * Throwaway (ADR 0030, 2026-11 amendment).
 */

const blocked = () => toast(SAMPLE_SAVE_BLOCKED, { id: "sample-save-blocked" })

/* ------------------------------------------------------------------ Available and After this */

const AVAILABLE = 40

export function AvailableAfterDemo() {
  const [hours, setHours] = useState(16)
  const row = (label, value, strong = false) => (
    <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-mono tabular-nums", strong && "font-bold")}>{value}</span>
    </div>
  )
  return (
    <div className="max-w-sm space-y-3 rounded-xl border border-border bg-card p-4 shadow-sm">
      <div>
        <div className="text-label font-bold tracking-wider text-muted-foreground uppercase">Approvals · Leave</div>
        <div className="mt-0.5 text-base font-semibold">SIL · {PEOPLE.paolo.name}</div>
      </div>
      <div className="divide-y divide-border">
        <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
          <span className="text-muted-foreground">This request</span>
          <span className="flex items-center gap-1.5">
            <Button type="button" variant="outline" size="icon-xs" aria-label="Fewer hours" onClick={() => setHours((h) => Math.max(4, h - 4))} disabled={hours <= 4}>
              <Minus />
            </Button>
            <span className="w-12 text-center font-mono tabular-nums">{hours} h</span>
            <Button type="button" variant="outline" size="icon-xs" aria-label="More hours" onClick={() => setHours((h) => Math.min(AVAILABLE, h + 4))} disabled={hours >= AVAILABLE}>
              <Plus />
            </Button>
          </span>
        </div>
        {row("Available", `${AVAILABLE} h`)}
        <div key={hours} className="animate-check-flash rounded-md">{row("After this", `${AVAILABLE - hours} h`, true)}</div>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={blocked}>Decline</Button>
        <Button type="button" variant="primary" size="sm" onClick={blocked}>Approve</Button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ Still pending, whatever the month */

const monthLabel = (offset) => {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() + offset)
  return d.toLocaleString("en-US", { month: "long", year: "numeric" })
}

export function StillPendingDemo() {
  const months = useMemo(() => [-1, 0, 1].map(monthLabel), [])
  const [at, setAt] = useState(1)
  const lists = [
    [{ id: "r1", label: "Offset · 4 hours", status: "Approved", theme: "green" }],
    [
      { id: "r2", label: "Overtime · 3 hours", status: "Approved", theme: "green" },
      { id: "r3", label: "SIL · 1 day", status: "Approved", theme: "green" },
    ],
    [],
  ]
  return (
    <div className="max-w-md space-y-3">
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="icon-sm" aria-label="Previous month" onClick={() => setAt((i) => Math.max(0, i - 1))} disabled={at === 0}>
          <ChevronLeft />
        </Button>
        <span className="min-w-36 text-center text-sm font-semibold" aria-live="polite">{months[at]}</span>
        <Button type="button" variant="outline" size="icon-sm" aria-label="Next month" onClick={() => setAt((i) => Math.min(2, i + 1))} disabled={at === 2}>
          <ChevronRight />
        </Button>
      </div>
      <section className="space-y-1.5" aria-label="Still pending">
        <h4 className="text-label font-bold tracking-wider text-muted-foreground uppercase">Still pending</h4>
        <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm">
          <span>SIL · 2 days · filed in {months[0]}</span>
          <StatusBadge label="Waiting for your head" theme="amber" />
        </div>
      </section>
      <section className="space-y-1.5" aria-label={months[at]}>
        <h4 className="text-label font-bold tracking-wider text-muted-foreground uppercase">{months[at]}</h4>
        {lists[at].length === 0 ? (
          <div key={at} className="animate-content-in space-y-2 rounded-lg border border-dashed border-border px-3 py-4 text-center">
            <p className="text-sm text-muted-foreground">Nothing filed in {months[at]}.</p>
            <Button type="button" variant="outline" size="sm" onClick={blocked}>File Time Off / Overtime</Button>
          </div>
        ) : (
          <ul key={at} className="animate-content-in space-y-1.5">
            {lists[at].map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm">
                <span>{r.label}</span>
                <StatusBadge label={r.status} theme={r.theme} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

/* ------------------------------------------------------------------ Before and After: the File Time Off form */

const OFFSET_FIELDS = [
  { key: "date", label: "Offset date", error: "Enter the Offset date.", placeholder: "Pick a day" },
  { key: "hours", label: "Hours", error: "Enter the hours.", placeholder: "e.g. 8", numeric: true },
  { key: "head", label: "Department Head", error: "Choose a department head.", options: [PEOPLE.lara.name, PEOPLE.mark.name] },
  { key: "reason", label: "Reason", error: "Enter the reason.", placeholder: "Why you need it" },
]
const OFFSET_HOURS = 4
const offsetBalance = (values) => {
  const needed = Number(String(values.hours ?? "").replace(/,/g, ""))
  return needed > OFFSET_HOURS ? `You have ${OFFSET_HOURS} Offset hours. This needs ${needed}.` : null
}

function OffsetForm({ mode }) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {mode === "after" ? `Press File Offset empty, then type 8 hours (you have ${OFFSET_HOURS}).` : "Press Submit with the form empty."}
      </p>
      <MiniForm fields={OFFSET_FIELDS} mode={mode} submitLabel={mode === "after" ? "File Offset" : "Submit"} check={offsetBalance} />
    </div>
  )
}

/* ------------------------------------------------------------------ Before and After: the Department Head box */

const HEADS = [
  { ...PEOPLE.lara, isHead: true },
  { ...PEOPLE.mark, isHead: true },
  { ...PEOPLE.joy, isHead: true },
  { ...PEOPLE.nina, isHead: true },
].sort((a, b) => a.name.localeCompare(b.name))
const APPLICANT = { id: "sample-applicant", department: "SALES", sub_department: "GOVERNMENT" }

function HeadBefore() {
  return (
    <div aria-hidden="true" className="space-y-2">
      <MockField label="Department Head" placeholder="Select head..." />
      <div className="rounded-lg border border-border bg-card p-1 text-xs shadow-lg">
        {HEADS.map((h) => (
          <div key={h.id} className="rounded-md px-2 py-1.5">{h.name}</div>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">An empty box, every head by name only, and no word on why.</p>
    </div>
  )
}

function HeadAfter() {
  const [value, setValue] = useState(null)
  return (
    <SampleProvider seed={[[["departmentHeads"], HEADS]]}>
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">This employee is in Sales / Government, which has two heads. Open the box.</p>
        <HeadSelectField employee={APPLICANT} value={value} onChange={setValue} required />
      </div>
    </SampleProvider>
  )
}

/* ------------------------------------------------------------------ Before and After: one colour and one name per type */

const MIXED = {
  "My Requests": [["LWOP", "bg-orange-2 text-orange-11 border-orange-6"], ["Overtime", ENTRY_KINDS.OVERTIME.chip], ["SIL Leave", ENTRY_KINDS.SIL.chip]],
  Calendar: [["LWOP", ENTRY_KINDS.LWOP.chip], ["Overtime", ENTRY_KINDS.OVERTIME.chip], ["SIL", ENTRY_KINDS.SIL.chip]],
  "HR list": [["LWOP", "bg-orange-2 text-orange-11 border-orange-6"], ["Overtime", "bg-mauve-2 text-mauve-11 border-mauve-6"], ["SIL Leave", ENTRY_KINDS.SIL.chip]],
}
const SAME = [["LWOP", ENTRY_KINDS.LWOP.chip], ["Overtime", ENTRY_KINDS.OVERTIME.chip], ["SIL", ENTRY_KINDS.SIL.chip]]
const COLOUR_TIMES = [1200, 3000]

function Colours({ fixed }) {
  const [ref, phase] = useScene(COLOUR_TIMES)
  const settle = fixed && phase >= 1
  return (
    <div ref={ref} aria-hidden="true" className="grid grid-cols-3 gap-2">
      {Object.entries(MIXED).map(([screen, chips]) => (
        <div key={screen} className="space-y-1.5 rounded-lg border border-border bg-card p-2">
          <div className="text-[10px] font-semibold text-muted-foreground">{screen}</div>
          {(settle ? SAME : chips).map(([label, tone], i) => (
            <span key={i} className={cn("flex w-fit rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-colors duration-700", tone)}>
              {label}
            </span>
          ))}
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ the pairs sampleRegistry.js names */

export const OffsetBefore = () => <OffsetForm mode="before" />
export const OffsetAfter = () => <OffsetForm mode="after" />
export { HeadBefore, HeadAfter }
export const ColoursBefore = () => <Colours fixed={false} />
export const ColoursAfter = () => <Colours fixed />
