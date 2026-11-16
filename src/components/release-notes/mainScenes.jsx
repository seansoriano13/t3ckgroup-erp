import { LogOut, MessageCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import StatusBadge from "../StatusBadge"
import { Cursor, Lines, MockWindow } from "./motion"
import { useScene } from "./useScene"
import { PEOPLE } from "./sampleData"

/**
 * Drawn scenes for the October–November page: the Before and After of its two fixes, and short
 * animations of four changes. Pictures only; the captions beside them carry the meaning.
 * Throwaway (ADR 0030, 2026-11 amendment).
 */

/* ------------------------------------------------------------------ Before and After: Closed Won counted as lost */

const COUNT_TIMES = [1000, 3200]

function Totals({ fixed }) {
  const [ref, phase] = useScene(COUNT_TIMES)
  const landed = phase >= 1
  const won = fixed && landed
  const lost = !fixed && landed
  return (
    <div ref={ref} aria-hidden="true" className="space-y-3">
      <div className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2 text-xs">
        <span className="font-mono">SOR-0398</span>
        <StatusBadge label="Closed Won" theme="green" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        {[
          ["Won (Realized)", won ? 1 : 0, won],
          ["Lost", lost ? 1 : 0, lost],
        ].map(([label, n, hit]) => (
          <div key={label} className={cn("rounded-lg border bg-card p-3 transition-colors duration-500", hit ? (label === "Lost" ? "border-red-7" : "border-green-7") : "border-border")}>
            <div className="text-[11px] text-muted-foreground">{label}</div>
            <div key={`${label}${n}`} className="animate-content-in font-mono text-xl font-bold">{n}</div>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">{fixed ? "The deal lands where it ended: Won." : "The deal that ended on Closed Won landed under Lost."}</p>
    </div>
  )
}

/* ------------------------------------------------------------------ Before and After: the Dashboard stopped at 1,000 */

const TALLY_TIMES = [2600, 2600]

function Tally({ fixed }) {
  const [ref, phase] = useScene(TALLY_TIMES)
  const total = fixed ? 1342 : 1000
  return (
    <div ref={ref} aria-hidden="true" className="space-y-3">
      <div className="rounded-lg border border-border bg-card p-3">
        <div className="text-[11px] text-muted-foreground">Tasks on the Dashboard</div>
        <div className="font-mono text-2xl font-bold tabular-nums">{phase >= 1 ? total.toLocaleString("en-US") : "…"}</div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-mauve-3">
          <div className={cn("h-full rounded-full", fixed ? "bg-green-9" : "bg-red-9")} style={{ width: phase >= 1 ? `${(total / 1342) * 100}%` : "0%", transition: `width ${phase >= 1 ? 1800 : 0}ms ease-out` }} />
        </div>
        <div className="mt-1 text-[11px] text-muted-foreground">{fixed ? "Every one of 1,342 sample tasks" : "Stops at 1,000, though there are 1,342"}</div>
      </div>
      {fixed && phase >= 1 && (
        <div className="animate-content-in rounded-lg border border-border bg-card p-3 text-xs">
          <div className="text-[11px] text-muted-foreground">Group Tasks, in their own row</div>
          <div className="mt-1 flex gap-4 font-mono">
            <span>Open 24</span>
            <span>Awaiting evaluation 6</span>
            <span>Completed 81</span>
          </div>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ Quick View lists the SOR's tasks */

const LIST_TIMES = [400, 400, 400, 400, 3000]

function QuickViewScene() {
  const [ref, phase] = useScene(LIST_TIMES)
  const tasks = [
    ["Prepare the bid documents", "You", "In progress"],
    ["Check the site", "You", "To do"],
    ["Price the base station", PEOPLE.joy.name, "In progress"],
    ["Review the specs", PEOPLE.carlo.name, "Done"],
  ]
  return (
    <div ref={ref} aria-hidden="true" className="max-w-md">
      <MockWindow title="SOR-0412 · Quick View">
        <div className="mb-2 text-[11px] font-semibold text-muted-foreground">Tasks on this SOR · yours first</div>
        <ul className="space-y-1.5">
          {tasks.map(([name, who, status], i) => (
            <li key={name} className={cn("flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-xs transition-all duration-500 ease-out-expo", phase > i ? "opacity-100" : "translate-y-1 opacity-0", who === "You" && "bg-muted/60")}>
              <span className="min-w-0 flex-1 truncate">{name}</span>
              <span className="text-muted-foreground">{who}</span>
              <StatusBadge label={status} theme={status === "Done" ? "green" : status === "To do" ? "mauve" : "blue"} />
            </li>
          ))}
        </ul>
      </MockWindow>
    </div>
  )
}

/* ------------------------------------------------------------------ A Group Task for an SOR shows the SOR's chat too */

const CHAT_TIMES = [700, 700, 700, 700, 2600]
const CHATS = [
  ["group", PEOPLE.carlo.name, "Site check booked for Monday."],
  ["sor", PEOPLE.lara.name, "Client moved the bid date to Friday."],
  ["group", PEOPLE.joy.name, "I will price the antenna kit today."],
  ["sor", PEOPLE.mark.name, "Noted. Keep the offer under the ABC."],
]

function TwoChatsScene() {
  const [ref, phase] = useScene(CHAT_TIMES)
  const column = (kind, title) => (
    <div className="min-w-0 space-y-1.5 rounded-lg border border-border bg-card p-2.5">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
        <MessageCircle size={12} /> {title}
      </div>
      {CHATS.map(([where, who, text], i) =>
        where === kind && phase > i ? (
          <div key={text} className="animate-content-in rounded-lg bg-muted px-2 py-1.5 text-[11px]">
            <span className="font-semibold">{who}: </span>
            {text}
          </div>
        ) : null,
      )}
    </div>
  )
  return (
    <div ref={ref} aria-hidden="true" className="max-w-2xl">
      <MockWindow title="Demo kickoff · Group Task for SOR-0412">
        <div className="grid gap-2 sm:grid-cols-2">
          {column("group", "This Group Task's chat")}
          {column("sor", "SOR-0412's chat")}
        </div>
      </MockWindow>
    </div>
  )
}

/* ------------------------------------------------------------------ Sign out from the sidebar */

const MENU_TIMES = [900, 600, 1200, 2200]

function SignOutScene() {
  const [ref, phase] = useScene(MENU_TIMES)
  return (
    <div ref={ref} aria-hidden="true" className="relative h-52 max-w-xs">
      <div className="absolute inset-y-0 left-0 w-56 space-y-2 rounded-xl border border-border bg-card p-2.5 shadow-sm">
        <div className={cn("flex items-center gap-2 rounded-md p-1.5 transition-colors", phase >= 1 && "bg-muted")}>
          <span className="size-7 rounded-full bg-mauve-5" />
          <span className="text-xs font-semibold">{PEOPLE.lara.name}</span>
        </div>
        {phase >= 2 && (
          <div className="popover-enter space-y-0.5 rounded-md border border-border bg-card p-1 text-xs shadow-lg">
            <div className="rounded px-2 py-1">My Profile</div>
            <div className="rounded px-2 py-1">Settings</div>
            <div className={cn("flex items-center gap-1.5 rounded px-2 py-1 font-semibold", phase >= 3 && "bg-muted")}>
              <LogOut size={12} /> Sign out
            </div>
          </div>
        )}
        <Lines n={3} />
      </div>
      <Cursor x={phase === 0 ? 70 : phase < 3 ? 30 : 22} y={phase === 0 ? 80 : phase < 3 ? 12 : 50} clicking={phase === 1} />
    </div>
  )
}

/* ------------------------------------------------------------------ Messages from one chat come as one notification */

const GROUP_TIMES = [1600, 3000]

function GroupedNotificationsScene() {
  const [ref, phase] = useScene(GROUP_TIMES)
  const grouped = phase >= 1
  const rows = [`${PEOPLE.paolo.name}: Are we on for Monday?`, `${PEOPLE.lara.name}: Yes, 9 am.`, `${PEOPLE.paolo.name}: I will bring the radios.`]
  return (
    <div ref={ref} aria-hidden="true" className="max-w-sm">
      <MockWindow title="Notifications">
        <div className="mb-2 flex items-center gap-2 text-[11px] text-muted-foreground">
          Unread
          <span className={cn("rounded-full px-1.5 text-[10px] font-bold transition-colors duration-500", grouped ? "bg-mauve-4 text-mauve-11" : "bg-red-9 text-white")}>{grouped ? 1 : 3}</span>
        </div>
        {grouped ? (
          <div className="animate-content-in rounded-md border border-border px-2.5 py-2 text-xs">
            <div className="font-semibold">Demo kickoff chat · 3 messages</div>
            <div className="truncate text-muted-foreground">{rows[2]}</div>
          </div>
        ) : (
          <ul className="space-y-1">
            {rows.map((r) => (
              <li key={r} className="truncate rounded-md border border-border px-2.5 py-1.5 text-xs">
                {r}
              </li>
            ))}
          </ul>
        )}
      </MockWindow>
    </div>
  )
}

/* ------------------------------------------------------------------ the scenes sampleRegistry.js names */

export const ClosedWonBefore = () => <Totals fixed={false} />
export const ClosedWonAfter = () => <Totals fixed />
export const DashboardBefore = () => <Tally fixed={false} />
export const DashboardAfter = () => <Tally fixed />
export { QuickViewScene, TwoChatsScene, SignOutScene, GroupedNotificationsScene }
