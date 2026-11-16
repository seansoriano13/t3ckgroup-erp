import { useState } from "react"
import { ArrowRight, Bell, Check, ChevronDown, ChevronRight, Link2, Lock, Monitor, RotateCw, Smartphone, X } from "lucide-react"
import toast from "react-hot-toast"
import { Button } from "@/components/ui/button"
import TabGroup from "@/components/ui/TabGroup"
import RecordNotFound from "@/components/ui/RecordNotFound"
import { cn } from "@/lib/utils"
import { NoAccess } from "../ProtectedRoute"
import NotificationTypeIcon from "../NotificationTypeIcon"
import { MODULE_TABS, typeInTab } from "../../utils/notificationMeta"
import { Cursor, Lines, MockButton, MockWindow } from "./motion"
import { useScene } from "./useScene"
import { SAMPLE_SAVE_BLOCKED } from "./SampleProvider"

/**
 * The Everywhere tab: links that open the exact window, the bell, What's New, the menu, and the
 * fixes behind them. Demos are live (local state only, nothing is read or saved); the Before and
 * After scenes are drawn. Throwaway (ADR 0030, 2026-11 amendment).
 */

const HOST = "t3ckgroup-erp.online"
const blocked = () => toast(SAMPLE_SAVE_BLOCKED, { id: "sample-save-blocked" })

/* ------------------------------------------------------------------ links: every window has an address */

const SOR_TABS = [
  { value: "summary", label: "Summary" },
  { value: "products", label: "Products" },
  { value: "pms", label: "PMS" },
  { value: "history", label: "History" },
]
const TAB_BODY = {
  summary: ["Stage: Bid Submitted", "Deal Owner: Lara Mendoza", "Expected value: ₱500,000.00"],
  products: ["10 × Demo handheld radio", "1 × Demo radio base station"],
  pms: ["Purchase Request: Demo radio network", "IPAS: TGIPAS-0001 · open"],
  history: ["Lead → Technical Review", "Technical Review → Bid Submitted"],
}

export function LinksDemo() {
  const [open, setOpen] = useState(true)
  const [tab, setTab] = useState("summary")
  const [note, setNote] = useState("Click a tab, then look at the address.")
  const [flash, setFlash] = useState(false)
  const address = open ? `${HOST}/sors?open=sor:SOR-0412${tab === "summary" ? "" : `&view=${tab}`}` : `${HOST}/sors`

  const refresh = () => {
    setFlash(true)
    setTimeout(() => setFlash(false), 450)
    setNote(open ? "The page reloaded, and the SOR opened again on the same tab." : "The page reloaded. No window was open, so none opens.")
  }

  return (
    <div className="max-w-2xl space-y-3">
      <MockWindow address={address}>
        <div className={cn("relative min-h-64 transition-opacity duration-200", flash && "opacity-30")}>
          <div className="space-y-3 p-1" aria-hidden="true">
            <div className="text-xs font-semibold text-muted-foreground">SORS</div>
            <Lines n={3} />
            <Lines n={2} />
          </div>
          {open ? (
            <div className="animate-content-in absolute inset-1 space-y-3 rounded-xl border border-border bg-card p-3 shadow-lg">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-mono text-[11px] text-muted-foreground">SOR-0412</div>
                  <div className="truncate text-sm font-semibold">Demo radio network</div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button type="button" variant="ghost" size="icon-sm" aria-label="Copy link" title="Copy link" onClick={() => setNote("Link copied. Anyone who may see this SOR opens it on this same tab.")}>
                    <Link2 size={14} />
                  </Button>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label="Close the SOR" onClick={() => { setOpen(false); setNote("Closed: the address no longer names the SOR, so Back works in one step.") }}>
                    <X size={14} />
                  </Button>
                </div>
              </div>
              <TabGroup tabs={SOR_TABS} activeTab={tab} onChange={(v) => { setTab(v); setNote("The tab is in the address now. Send it and the other person lands here.") }} size="sm" />
              <ul className="space-y-1.5 text-[13px] text-foreground">
                {TAB_BODY[tab].map((line) => (
                  <li key={line} className="animate-content-in">{line}</li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <Button type="button" variant="outline" size="sm" onClick={() => { setOpen(true); setTab("summary"); setNote("Opened. The address names the SOR.") }}>
                Open SOR-0412
              </Button>
            </div>
          )}
        </div>
      </MockWindow>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" size="sm" onClick={refresh}>
          <RotateCw aria-hidden="true" />
          Refresh the page
        </Button>
        <p className="min-w-0 flex-1 text-sm text-muted-foreground" aria-live="polite">{note}</p>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ the bell */

const BELL = [
  { id: "n1", type: "TASK_ASSIGNED", text: "Lara Mendoza gave you a task: Demo site survey", when: "5m", unread: true, opens: "the task, over the page you are on" },
  { id: "n2", type: "GROUP_TASK_MENTION", text: "Paolo Reyes mentioned you in Demo kickoff", when: "20m", unread: true, opens: "that chat, over the page you are on" },
  { id: "n3", type: "OPPORTUNITY_STAGE_CHANGED", text: "SOR-0412 moved to Bid Submitted", when: "1h", unread: false, opens: "the SOR window" },
  { id: "n4", type: "SOR_BID_DECISION", text: "Mark Dizon decided Go on SOR-0412", when: "2h", unread: true, opens: "the SOR on its PMS tab" },
  { id: "n5", type: "TRANSMITTAL_SUBMITTED", text: "Transmittal TG03-0007 is ready to sign", when: "3h", unread: true, opens: "the Transmittal's own page" },
  { id: "n6", type: "PURCHASE_REQUEST_ITEM_ADDED", text: "A product was added to Demo rescue gear", when: "1d", unread: false, opens: "the Purchase Request window" },
  { id: "n7", type: "SIL_LEAVE_REQUEST", text: "Nina Ocampo filed SIL for 2 days", when: "1d", unread: true, opens: "the request in Approvals" },
  { id: "n8", type: "OVERTIME_DECISION", text: "Your overtime was approved", when: "2d", unread: false, opens: "the request in My Requests, even from another month" },
  { id: "n9", type: "MEETING_REMINDER", text: "Demo planning meeting starts in 30 minutes", when: "2d", unread: false, opens: "the meeting on the Calendar" },
]
const BELL_TABS = [{ value: "ALL", label: "ALL" }, { value: "UNREAD", label: "UNREAD" }, ...MODULE_TABS.map(({ value, label }) => ({ value, label }))]

export function BellDemo() {
  const [tab, setTab] = useState("ALL")
  const [picked, setPicked] = useState(null)
  const shown = BELL.filter((n) => (tab === "ALL" ? true : tab === "UNREAD" ? n.unread : typeInTab(n.type, tab)))
  return (
    <div className="max-w-xl space-y-3">
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="flex items-center gap-2 px-4 pt-3 text-sm font-semibold">
          <Bell size={15} aria-hidden="true" />
          Notifications
        </div>
        <TabGroup variant="underline" tabs={BELL_TABS} activeTab={tab} onChange={(v) => { setTab(v); setPicked(null) }} className="px-2" />
        <ul className="divide-y divide-border">
          {shown.map((n) => (
            <li key={n.id}>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setPicked(n)}
                className={cn("h-auto w-full justify-start gap-3 rounded-none px-4 py-2.5 text-left font-normal whitespace-normal", picked?.id === n.id && "bg-muted")}
              >
                <NotificationTypeIcon type={n.type} size={16} />
                <span className="min-w-0 flex-1 text-[13px] text-foreground">{n.text}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground">{n.when}</span>
                {n.unread && <span className="size-2 shrink-0 rounded-full bg-mauve-11" aria-label="Unread" />}
              </Button>
            </li>
          ))}
        </ul>
      </div>
      <p className="flex min-h-5 items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
        {picked ? (
          <>
            <ArrowRight size={14} aria-hidden="true" />
            <span>
              In the app this opens <span className="font-semibold text-foreground">{picked.opens}</span>.
            </span>
          </>
        ) : (
          "Pick a tab, then click a notification to see where it goes."
        )}
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------ What's New only for your modules */

const WHO = [
  { value: "purchasing", label: "I work in Purchasing" },
  { value: "sales", label: "I work in Sales" },
]

export function WhatsNewDemo() {
  const [who, setWho] = useState("purchasing")
  return (
    <div className="max-w-2xl space-y-3">
      <TabGroup tabs={WHO} activeTab={who} onChange={setWho} size="sm" />
      <p className="text-sm text-muted-foreground">
        A new update is about <span className="font-semibold text-foreground">Canvasses</span>, which only Purchasing opens.
      </p>
      <div className="relative grid min-h-48 grid-cols-[9rem_minmax(0,1fr)] overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="space-y-1.5 border-r border-border bg-muted/40 p-2.5 text-xs" aria-hidden="true">
          <div className="rounded-md px-2 py-1 text-muted-foreground">Dashboard</div>
          <div className="rounded-md px-2 py-1 text-muted-foreground">SORS</div>
          <div className={cn("flex items-center justify-between rounded-md px-2 py-1 font-semibold", who === "sales" ? "bg-card text-foreground" : "text-muted-foreground")}>
            Release Notes
            {who === "sales" && <span className="animate-success-pop size-2 rounded-full bg-red-9" />}
          </div>
        </div>
        <div className="relative p-3" aria-hidden="true">
          <Lines n={3} />
          {who === "purchasing" && (
            <div className="modal-enter absolute inset-3 flex flex-col justify-between rounded-xl border border-border bg-card p-3 shadow-lg">
              <div>
                <div className="text-label font-bold tracking-wider text-muted-foreground uppercase">What&apos;s new</div>
                <div className="mt-1 text-sm font-semibold">One Canvass for the whole request</div>
                <Lines n={2} className="mt-2" />
              </div>
              <div className="flex justify-end">
                <MockButton tone="dark">Open Release Notes</MockButton>
              </div>
            </div>
          )}
        </div>
      </div>
      <p className="text-sm text-foreground" aria-live="polite">
        {who === "purchasing"
          ? "Purchasing sees the pop-up, because the update is about their work."
          : "Sales gets no pop-up. A dot on Release Notes in the menu waits until they open it."}
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------ the menu opens where you are */

const MENU_TIMES = [900, 900, 1600, 2200]

export function MenuScene() {
  const [ref, phase] = useScene(MENU_TIMES)
  const hrOpen = phase >= 1
  return (
    <div ref={ref} aria-hidden="true" className="grid max-w-2xl gap-4 sm:grid-cols-[13rem_minmax(0,1fr)]">
      <div className="space-y-1 rounded-xl border border-border bg-card p-2.5 text-xs shadow-sm">
        <div className="rounded-md px-2 py-1.5 text-muted-foreground">Dashboard</div>
        <div className="flex items-center gap-1 px-2 py-1.5 text-label font-black tracking-widest text-muted-foreground uppercase">
          <ChevronRight size={12} /> Sales
        </div>
        <div className="flex items-center gap-1 px-2 py-1.5 text-label font-black tracking-widest text-foreground uppercase">
          {hrOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Human Resources
        </div>
        {hrOpen && (
          <div className="animate-slide-down pl-3">
            <div className="rounded-md px-2 py-1.5 text-muted-foreground">Employee Directory</div>
            <div className={cn("relative rounded-md px-2 py-1.5 font-semibold transition-colors duration-300", phase >= 2 ? "bg-mauve-4 text-foreground" : "text-muted-foreground")}>
              Time Off &amp; Over…
              {phase >= 3 && (
                <span className="popover-enter absolute top-full left-2 z-10 mt-1 rounded-md bg-foreground px-2 py-1 whitespace-nowrap text-background shadow-lg">
                  Time Off &amp; Overtime
                </span>
              )}
            </div>
            <div className="h-8" />
          </div>
        )}
      </div>
      <div className="space-y-2">
        <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm font-semibold shadow-sm">
          <Smartphone size={14} className="text-muted-foreground" />
          {phase >= 2 ? "Time Off & Overtime" : "T3CKGROUP ERP"}
        </div>
        <p className="text-xs text-muted-foreground">On a phone, the top bar names the page you are on.</p>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ Before and After: notification clicks */

const CLICK_TIMES = [900, 900, 450, 2400]

function NotificationClick({ works }) {
  const [ref, phase] = useScene(CLICK_TIMES)
  const clicked = phase >= 3
  const address = works && clicked ? `${HOST}/offsets?record=req-0091` : `${HOST}/dashboard`
  return (
    <div ref={ref} aria-hidden="true" className="relative">
      <MockWindow address={address}>
        <div className="relative min-h-40">
          <Lines n={3} />
          {!(works && clicked) && (
            <div className="absolute top-0 right-0 w-56 rounded-lg border border-border bg-card p-1.5 shadow-lg">
              <div className="px-2 py-1 text-[11px] font-semibold text-muted-foreground">Notifications</div>
              <div className={cn("rounded-md px-2 py-1.5 text-[11px] transition-colors", phase >= 2 ? "bg-muted" : "")}>Your SIL was approved</div>
              <div className="rounded-md px-2 py-1.5 text-[11px] text-muted-foreground">Demo planning meeting tomorrow</div>
            </div>
          )}
          {works && clicked && (
            <div className="animate-content-in absolute inset-y-0 right-0 w-56 space-y-1.5 rounded-lg border border-border bg-card p-3 shadow-lg">
              <div className="text-[11px] text-muted-foreground">My Requests</div>
              <div className="text-sm font-semibold">SIL · 2 days</div>
              <span className="inline-flex rounded-full border border-green-6 px-2 py-0.5 text-label font-bold tracking-wider text-green-11 uppercase">Approved</span>
              <Lines n={2} />
            </div>
          )}
          {!works && clicked && <div className="animate-slide-down absolute bottom-0 left-0 text-xs font-medium text-muted-foreground">Nothing opened.</div>}
          <Cursor x={phase === 0 ? 20 : 60} y={phase === 0 ? 80 : 30} clicking={phase === 2} hidden={works && clicked} />
        </div>
      </MockWindow>
    </div>
  )
}

/* ------------------------------------------------------------------ Before and After: a link to something gone */

const LOAD_TIMES = [1800, 2600]

function DeadLinkBefore() {
  const [ref, phase] = useScene(LOAD_TIMES)
  return (
    <div ref={ref} aria-hidden="true">
      <MockWindow address={`${HOST}/purchasing/ipas/not-a-real-id`}>
        <div className="flex min-h-36 items-center justify-center">
          {phase === 0 ? (
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <RotateCw size={14} className="animate-spin" /> Loading…
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">
              Something went wrong. <span className="underline">Retry</span>
            </span>
          )}
        </div>
      </MockWindow>
    </div>
  )
}

function DeadLinkAfter() {
  return (
    <MockWindow address={`${HOST}/purchasing/ipas/not-a-real-id`}>
      <RecordNotFound recordType="IPAS" onBack={blocked} backLabel="Back to IPAS" />
    </MockWindow>
  )
}

/* ------------------------------------------------------------------ Before and After: a page you cannot open */

const BOUNCE_TIMES = [1400, 2400]

function NoAccessBefore() {
  const [ref, phase] = useScene(BOUNCE_TIMES)
  return (
    <div ref={ref} aria-hidden="true">
      <MockWindow address={phase === 0 ? `${HOST}/approvals/leaves` : `${HOST}/`}>
        <div className="min-h-36 space-y-3">
          {phase === 0 ? (
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <RotateCw size={14} className="animate-spin" /> Opening Leave Approvals…
            </span>
          ) : (
            <div className="animate-content-in space-y-2">
              <div className="text-sm font-semibold">Dashboard</div>
              <Lines n={3} />
              <p className="text-[11px] text-muted-foreground">No message. Why am I here?</p>
            </div>
          )}
        </div>
      </MockWindow>
    </div>
  )
}

function NoAccessAfter() {
  // The real screen, kept from leaving Release Notes: its Dashboard link would take the reader away.
  return (
    <div
      className="[&_[role=alert]]:min-h-0 [&_[role=alert]]:p-0"
      onClickCapture={(event) => {
        if (event.target.closest("a")) {
          event.preventDefault()
          blocked()
        }
      }}
    >
      <MockWindow address={`${HOST}/approvals/leaves`}>
        <NoAccess needs="Head or HR access" grantedBy="HR or a Super Admin" />
      </MockWindow>
    </div>
  )
}

/* ------------------------------------------------------------------ Before and After: lists that timed out */

const SLOW = [
  { label: "Your chats", where: "Chat button" },
  { label: "Group Tasks", where: "Approvals → Tasks" },
  { label: "SOR history", where: "My work and the List" },
]
const SLOW_TIMES = [3200, 2600]
const FAST_TIMES = [700, 4200]

function Loading({ fast }) {
  const [ref, phase] = useScene(fast ? FAST_TIMES : SLOW_TIMES)
  const done = phase === 1
  return (
    <ul ref={ref} aria-hidden="true" className="space-y-3">
      {SLOW.map((row) => (
        <li key={row.label} className="space-y-1">
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <span className="font-semibold text-foreground">{row.label}</span>
            <span className="text-muted-foreground">{row.where}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-mauve-4">
            <div
              className={cn("h-full rounded-full", done ? (fast ? "bg-green-9" : "bg-red-9") : "bg-mauve-9")}
              style={{ width: phase === 0 ? "0%" : "100%", transition: `width ${phase === 0 ? 0 : fast ? 500 : 3000}ms linear` }}
            />
          </div>
          <div className="h-4 text-[11px]">
            {done && (fast ? <span className="text-green-11">Loaded</span> : <span className="text-red-11">Took too long. Could not load.</span>)}
          </div>
        </li>
      ))}
    </ul>
  )
}

/* ------------------------------------------------------------------ Before and After: who reads a Group Task chat */

const CHAT_PEOPLE = [
  { initials: "LM", role: "Creator", member: true },
  { initials: "PR", role: "Member", member: true },
  { initials: "MD", role: "Evaluator", member: true },
  { initials: "JV", role: "Not in it", member: false },
  { initials: "CB", role: "Not in it", member: false },
  { initials: "NO", role: "Not in it", member: false },
]
const CHAT_TIMES = [700, 3000]

function ChatReaders({ private: closed }) {
  const [ref, phase] = useScene(CHAT_TIMES)
  return (
    <div ref={ref} aria-hidden="true" className="space-y-3">
      <div className="rounded-lg border border-border bg-card p-2.5 text-xs">
        <div className="font-semibold">Demo bid strategy · Group Task chat</div>
        <div className="mt-1 text-muted-foreground">“Let us hold the price until Friday.”</div>
      </div>
      <ul className="grid grid-cols-3 gap-2">
        {CHAT_PEOPLE.map((p, i) => {
          const reads = !closed || p.member
          return (
            <li key={p.initials} className="flex flex-col items-center gap-1 text-center">
              <span className="relative flex size-9 items-center justify-center rounded-full bg-mauve-4 text-xs font-bold text-foreground">
                {p.initials}
                {phase >= 1 && (
                  <span
                    className={cn("animate-success-pop absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-full ring-2 ring-card", reads ? "bg-green-9 text-white" : "bg-mauve-11 text-white")}
                    style={{ animationDelay: `${i * 120}ms` }}
                  >
                    {reads ? <Check size={10} /> : <Lock size={9} />}
                  </span>
                )}
              </span>
              <span className="text-[10px] text-muted-foreground">{p.role}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/* ------------------------------------------------------------------ Before and After: What's New on a second browser */

const SEEN_TIMES = [1000, 1000, 2600]

function SecondBrowser({ remembers }) {
  const [ref, phase] = useScene(SEEN_TIMES)
  const popup = (where) => (
    <div className="modal-enter absolute inset-2 flex flex-col justify-between rounded-lg border border-border bg-card p-2 shadow-lg">
      <div className="text-[11px] font-semibold">What&apos;s new</div>
      <div className="flex justify-end">
        <MockButton tone="dark" className="h-5 px-2 text-[10px]">{where === "pc" ? "Got it" : "Got it… again?"}</MockButton>
      </div>
    </div>
  )
  return (
    <div ref={ref} aria-hidden="true" className="grid grid-cols-2 gap-3">
      <div className="space-y-1">
        <div className="flex items-center gap-1 text-[11px] text-muted-foreground"><Monitor size={12} /> Office PC</div>
        <div className="relative h-28 rounded-lg border border-border bg-card p-2">
          <Lines n={3} />
          {phase === 0 && popup("pc")}
          {phase >= 1 && <div className="absolute bottom-1.5 left-2 text-[10px] text-green-11">Seen</div>}
        </div>
      </div>
      <div className="space-y-1">
        <div className="flex items-center gap-1 text-[11px] text-muted-foreground"><Smartphone size={12} /> Your phone, later</div>
        <div className="relative h-28 rounded-lg border border-border bg-card p-2">
          <Lines n={3} />
          {phase === 2 && !remembers && popup("phone")}
          {phase === 2 && remembers && <div className="animate-content-in absolute bottom-1.5 left-2 text-[10px] text-green-11">No pop-up: your account remembers.</div>}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ Before and After: the phone menu */

const TAP_TIMES = [900, 700, 2400]

function PhoneMenu({ fixed }) {
  const [ref, phase] = useScene(TAP_TIMES)
  const tapped = phase === 2
  const closedByMistake = !fixed && tapped
  return (
    <div ref={ref} aria-hidden="true" className="flex justify-center">
      <div className="relative h-52 w-44 overflow-hidden rounded-[1.4rem] border-4 border-mauve-6 bg-desk">
        {!closedByMistake ? (
          <div className="absolute inset-y-0 left-0 w-36 space-y-2 border-r border-border bg-card p-2">
            <div className="relative flex items-center gap-1.5 rounded-md bg-muted/60 p-1.5">
              <span className="size-6 rounded-full bg-mauve-5" />
              <span className="min-w-0 flex-1 truncate text-[10px] font-semibold">Lara Mendoza</span>
              {fixed && (
                <span className="flex size-5 shrink-0 items-center justify-center rounded-md border border-border bg-card">
                  <X size={10} />
                </span>
              )}
              {!fixed && (
                <span className="absolute -top-1.5 right-0 flex size-6 items-center justify-center rounded-md border border-red-7 bg-card shadow">
                  <X size={11} />
                </span>
              )}
            </div>
            {fixed && tapped && (
              <div className="popover-enter space-y-1 rounded-md border border-border bg-card p-1.5 text-[10px] shadow-lg">
                <div>My Profile</div>
                <div>Sign out</div>
              </div>
            )}
            <Lines n={4} />
          </div>
        ) : (
          <div className="animate-content-in p-3 text-[11px] text-muted-foreground">The menu closed. You meant to open your profile.</div>
        )}
        <Cursor x={phase === 0 ? 30 : 62} y={phase === 0 ? 75 : 7} clicking={phase === 1} hidden={tapped} />
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ the pairs sampleRegistry.js names */

export const NotificationClickBefore = () => <NotificationClick works={false} />
export const NotificationClickAfter = () => <NotificationClick works />
export { DeadLinkBefore, DeadLinkAfter, NoAccessBefore, NoAccessAfter }
export const SpeedBefore = () => <Loading fast={false} />
export const SpeedAfter = () => <Loading fast />
export const ChatBefore = () => <ChatReaders private={false} />
export const ChatAfter = () => <ChatReaders private />
export const SeenBefore = () => <SecondBrowser remembers={false} />
export const SeenAfter = () => <SecondBrowser remembers />
export const PhoneMenuBefore = () => <PhoneMenu fixed={false} />
export const PhoneMenuAfter = () => <PhoneMenu fixed />
