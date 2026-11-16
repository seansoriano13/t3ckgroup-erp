import { MoreHorizontal } from "lucide-react"
import { cn } from "@/lib/utils"
import StatusBadge from "../StatusBadge"
import MiniForm from "./MiniForm"
import { Cursor, Lines, MockButton, MockField, MockToast, MockWindow } from "./motion"
import { useScene } from "./useScene"

/**
 * The SORs tab: Before and After scenes for the SORS fixes of this release. Drawn, except the
 * Register SOR form, which the reader can try in both versions. Throwaway (ADR 0030, 2026-11 amendment).
 */

/* ------------------------------------------------------------------ the real Stage, and one meaning of Won */

const GROW_TIMES = [900, 3200]

function StageCounts({ fixed }) {
  const [ref, phase] = useScene(GROW_TIMES)
  const rows = fixed
    ? [["Lead", 3], ["Bid Submitted", 3], ["Notice to Proceed", 1], ["Awarded", 4], ["PO Received", 1]]
    : [["Lead", 6], ["Proposal Submitted", 6], ["Closed Won", 0]]
  const rate = fixed ? 42 : 0
  return (
    <div ref={ref} aria-hidden="true" className="space-y-3">
      <div className="rounded-lg border border-border bg-card p-3">
        <div className="mb-2 flex items-baseline justify-between text-xs">
          <span className="font-semibold">Paolo Reyes · 12 SORs</span>
          <span className="text-muted-foreground">
            Win rate{" "}
            <span className={cn("font-mono text-sm font-bold transition-colors", fixed ? "text-green-11" : "text-red-11")}>{phase >= 1 ? rate : "…"}%</span>
          </span>
        </div>
        <ul className="space-y-1">
          {rows.map(([stage, n], i) => (
            <li key={stage} className="grid grid-cols-[8.5rem_minmax(0,1fr)_1.5rem] items-center gap-2 text-[11px]">
              <span className="truncate text-muted-foreground">{stage}</span>
              <span className="h-2 overflow-hidden rounded-full bg-mauve-3">
                <span
                  className="block h-full rounded-full bg-mauve-9"
                  style={{ width: phase >= 1 ? `${(n / 6) * 100}%` : "0%", transition: `width 600ms cubic-bezier(0.16,1,0.3,1) ${i * 90}ms` }}
                />
              </span>
              <span className="text-right font-mono">{n}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2 text-[11px]">
        <span className="font-mono">SOR-0412</span>
        <span className="text-muted-foreground">Commission table</span>
        <StatusBadge label={fixed ? "Notice to Proceed" : "Lead"} theme={fixed ? "blue" : "mauve"} />
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ the SOR number leads every row */

function Rows({ fixed }) {
  const [ref, phase] = useScene(GROW_TIMES)
  const rows = [
    { sor: "SOR-0412", project: "Demo clinic radios" },
    { sor: "SOR-0415", project: "Demo clinic repeaters" },
  ]
  return (
    <div ref={ref} aria-hidden="true" className="space-y-2">
      <div className="text-[11px] font-semibold text-muted-foreground">My work</div>
      {rows.map((row, i) => (
        <div key={row.sor} className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs">
          {fixed && (
            <span
              className="font-mono font-semibold text-foreground transition-all duration-500 ease-out-expo"
              style={{ opacity: phase >= 1 ? 1 : 0, transform: phase >= 1 ? "none" : "translateX(-6px)", transitionDelay: `${i * 120}ms` }}
            >
              {row.sor}
            </span>
          )}
          <span className={cn("font-mono", fixed ? "text-muted-foreground" : "font-semibold")}>S01234</span>
          <span className="min-w-0 flex-1 truncate text-muted-foreground">{fixed ? row.project : "Demo Clinic"}</span>
        </div>
      ))}
      <p className="text-[11px] text-muted-foreground">{fixed ? "Two SORs, one S0: each row says which SOR it is." : "Two SORs on the same S0 looked the same."}</p>
    </div>
  )
}

/* ------------------------------------------------------------------ Mark as Lost on a flow with no Lost Stage */

const LOST_TIMES = [900, 1100, 600, 1300, 1800]

function MarkLostBefore() {
  const [ref, phase] = useScene(LOST_TIMES)
  return (
    <div ref={ref} aria-hidden="true" className="relative min-h-48">
      <div className="space-y-2.5 rounded-lg border border-border bg-card p-3">
        <div className="text-sm font-semibold">Mark as Lost</div>
        <MockField label="Reason" value={phase >= 1 ? "Price too high" : ""} placeholder="Choose a reason" />
        <MockField label="Note" value={phase >= 1 ? "Client went with a cheaper bid." : ""} />
        <div className="flex justify-end">
          <MockButton tone="dark" pressed={phase === 2}>Mark as Lost</MockButton>
        </div>
      </div>
      <MockToast show={phase === 3} tone="error">This SOR could not be marked as Lost.</MockToast>
      <Cursor x={phase < 1 ? 20 : 78} y={phase < 1 ? 40 : 80} clicking={phase === 2} hidden={phase >= 4} />
      {phase === 4 && <p className="animate-slide-down absolute bottom-0 left-1 text-[11px] text-muted-foreground">The message is gone. The dialog sits there, filled in.</p>}
    </div>
  )
}

function MarkLostAfter() {
  const [ref, phase] = useScene(GROW_TIMES)
  return (
    <div ref={ref} aria-hidden="true" className="relative min-h-48">
      <div className="ml-auto w-52 space-y-0.5 rounded-lg border border-border bg-card p-1.5 text-xs shadow-lg">
        <div className="flex items-center gap-1.5 px-2 py-1 text-[11px] text-muted-foreground">
          <MoreHorizontal size={12} /> More actions
        </div>
        <div className="rounded-md px-2 py-1.5">Edit SOR</div>
        <div className={cn("rounded-md px-2 py-1.5 text-muted-foreground/60", phase >= 1 && "bg-muted")}>Mark as Lost</div>
        <div className="rounded-md px-2 py-1.5">Delete SOR</div>
      </div>
      {phase >= 1 && (
        <div className="popover-enter absolute top-24 right-4 max-w-52 rounded-md bg-foreground px-2.5 py-1.5 text-[11px] text-background shadow-lg">
          This Sales Flow has no Lost Stage yet.
        </div>
      )}
      <Cursor x={phase < 1 ? 30 : 70} y={phase < 1 ? 85 : 42} />
    </div>
  )
}

/* ------------------------------------------------------------------ Register SOR names every missing field */

const REGISTER_FIELDS = [
  { key: "saleType", label: "Sale Type", error: "Sale Type is required.", options: ["Project", "Outright"] },
  { key: "leadSource", label: "Lead Source", error: "Lead Source is required.", options: ["Referral", "Walk-in", "Website"] },
  { key: "company", label: "Company", error: "Company is required.", placeholder: "Demo Clinic" },
  { key: "contact", label: "Contact Person", error: "Contact Person is required.", placeholder: "Who you talk to" },
  { key: "project", label: "Project", error: "Project is required.", placeholder: "Demo clinic radios" },
]

function RegisterForm({ mode }) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">Press Register SOR with the form empty.</p>
      <MiniForm fields={REGISTER_FIELDS} mode={mode} submitLabel="Register SOR" />
    </div>
  )
}

/* ------------------------------------------------------------------ the History line counts missing fields */

function HistoryLine({ fixed }) {
  const [ref, phase] = useScene(GROW_TIMES)
  return (
    <div ref={ref} aria-hidden="true" className="space-y-2.5">
      <div className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2 text-xs">
        <span className="font-mono">SOR-0412</span>
        <StatusBadge label="Blocked: 1" theme="amber" />
      </div>
      <div className="rounded-lg border border-border bg-card p-3 text-xs">
        <div className="mb-1 text-[11px] font-semibold text-muted-foreground">History</div>
        <div className="flex items-center justify-between gap-2">
          <span className="font-semibold">Bid Submitted · now</span>
          <span
            className={cn("transition-all duration-500", fixed ? "font-semibold text-amber-12" : "text-muted-foreground")}
            style={{ opacity: phase >= 1 ? 1 : 0 }}
          >
            {fixed ? "1 required field missing" : "Nothing outstanding"}
          </span>
        </div>
        <Lines n={2} className="mt-2" />
      </div>
      {!fixed && phase >= 1 && <p className="animate-slide-down text-[11px] text-muted-foreground">The header and the History said different things.</p>}
    </div>
  )
}

/* ------------------------------------------------------------------ one SOR count for the List and the Board */

function Counts({ fixed }) {
  const [ref, phase] = useScene(GROW_TIMES)
  return (
    <div ref={ref} aria-hidden="true" className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        {[["List", 144], ["Board", fixed ? 144 : 145]].map(([view, n]) => (
          <MockWindow key={view} title={view}>
            <div className="font-mono text-2xl font-bold">{phase >= 1 ? n : "…"}</div>
            <div className="text-[11px] text-muted-foreground">SORs, no filter</div>
          </MockWindow>
        ))}
      </div>
      {fixed ? (
        phase >= 1 && (
          <p className="animate-slide-down text-[11px] text-muted-foreground">
            The same count on both. Its hover says: <span className="font-medium text-foreground">1 Lost SOR is not counted.</span>
          </p>
        )
      ) : (
        phase >= 1 && <p className="animate-slide-down text-[11px] text-red-11">144 or 145? The Board counted the Lost SOR, the List did not.</p>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ the pairs sampleRegistry.js names */

export const StageBefore = () => <StageCounts fixed={false} />
export const StageAfter = () => <StageCounts fixed />
export const RowsBefore = () => <Rows fixed={false} />
export const RowsAfter = () => <Rows fixed />
export { MarkLostBefore, MarkLostAfter }
export const RegisterBefore = () => <RegisterForm mode="before" />
export const RegisterAfter = () => <RegisterForm mode="after" />
export const HistoryBefore = () => <HistoryLine fixed={false} />
export const HistoryAfter = () => <HistoryLine fixed />
export const CountsBefore = () => <Counts fixed={false} />
export const CountsAfter = () => <Counts fixed />
