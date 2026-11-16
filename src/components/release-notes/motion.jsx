import { useState } from "react"
import { ArrowLeftRight, ArrowRight, Check, MousePointer2, Play, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import StatusBadge from "../StatusBadge"
import { useScene } from "./useScene"

/**
 * The moving parts of Release Notes: a scene that plays while it is on screen, the Before and After
 * pair a fix shows, and the two animations a change shows (steps that light up in turn, and cards
 * that arrive one by one). Scenes are pictures, not the real screen, so most are hidden from screen
 * readers and the caption beside them carries the meaning.
 *
 * Throwaway (ADR 0030, 2026-11 amendment): this serves one release's content.js.
 */

/* ------------------------------------------------------------------ the frames */

function FrameHint({ icon: Icon, label, onReplay }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">
        <Icon size={14} aria-hidden="true" />
        {label}
      </span>
      {onReplay && (
        <Button type="button" variant="ghost" size="xs" onClick={onReplay}>
          <RotateCcw aria-hidden="true" />
          Play again
        </Button>
      )}
    </div>
  )
}

function Pane({ side, text, children }) {
  const before = side === "before"
  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <StatusBadge label={before ? "Before" : "After"} theme={before ? "red" : "green"} />
        <span className="text-xs text-muted-foreground">{before ? "How it was" : "How it works now"}</span>
      </div>
      <div className="relative min-h-44 min-w-0 flex-1 overflow-hidden bg-muted/30 p-4">{children}</div>
      <p className="border-t border-border px-4 py-3 text-sm leading-relaxed text-foreground">{text}</p>
    </div>
  )
}

/**
 * A fix: what it was like, and what it is like now, side by side (stacked on a phone). `scene` is
 * `{ Before, After }`; each plays on its own, and Play again starts both over.
 */
export function BeforeAfter({ scene, before, after }) {
  const [run, setRun] = useState(0)
  const { Before, After } = scene
  return (
    <figure className="min-w-0 space-y-2">
      <FrameHint icon={ArrowLeftRight} label="Before and after" onReplay={() => setRun((r) => r + 1)} />
      <div className="grid min-w-0 gap-3 md:grid-cols-2">
        <Pane side="before" text={before}>
          <Before key={run} />
        </Pane>
        <Pane side="after" text={after}>
          <After key={run} />
        </Pane>
      </div>
    </figure>
  )
}

/** A change shown as a short animation of how it now works. Play again remounts it from the start. */
export function ChangeScene({ children, caption }) {
  const [run, setRun] = useState(0)
  return (
    <figure className="min-w-0 space-y-2">
      <FrameHint icon={Play} label="Watch how it works" onReplay={() => setRun((r) => r + 1)} />
      <div key={run} className="min-w-0 overflow-x-auto rounded-2xl border border-border bg-muted/30 p-4 sm:p-5">
        {children}
      </div>
      {caption && <figcaption className="text-xs text-muted-foreground">{caption}</figcaption>}
    </figure>
  )
}

/* ------------------------------------------------------------------ the two generic animations */

const STEP_TIME = 1700
const flowClock = new Map()
// One constant array per length, so useScene's clock does not restart on every render.
const flowDurations = (n) => {
  if (!flowClock.has(n)) flowClock.set(n, [...Array.from({ length: n - 1 }, () => STEP_TIME), STEP_TIME * 2])
  return flowClock.get(n)
}
const FLOW_COLS = { 2: "sm:grid-cols-2", 3: "sm:grid-cols-3", 4: "sm:grid-cols-2 lg:grid-cols-4", 5: "sm:grid-cols-2 lg:grid-cols-5" }

/** Steps in the order they happen; a highlight moves from one to the next, ticking off the done ones. */
export function Flow({ steps }) {
  const [ref, phase] = useScene(flowDurations(steps.length))
  return (
    <ol ref={ref} className={cn("grid min-w-0 gap-3", FLOW_COLS[steps.length] ?? "sm:grid-cols-3")}>
      {steps.map((step, i) => {
        const state = i < phase ? "done" : i === phase ? "now" : "next"
        return (
          <li
            key={step.title}
            data-state={state}
            className={cn(
              "min-w-0 rounded-xl border bg-card p-3.5 transition-all duration-500 ease-out-expo",
              state === "now" ? "-translate-y-0.5 border-mauve-11 shadow-md" : "border-border",
              state === "next" && "opacity-60",
            )}
          >
            <span
              className={cn(
                "mb-2 flex size-6 items-center justify-center rounded-full text-xs font-bold transition-colors duration-300",
                state === "done" ? "bg-green-a3 text-green-11" : state === "now" ? "bg-foreground text-background" : "bg-muted text-muted-foreground",
              )}
              aria-hidden="true"
            >
              {state === "done" ? <Check size={13} /> : i + 1}
            </span>
            <p className="text-sm font-semibold text-foreground">{step.title}</p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{step.text}</p>
          </li>
        )
      })}
    </ol>
  )
}

/** What changed, as cards that arrive one after another. */
export function Highlights({ items }) {
  return (
    <ul className="grid min-w-0 gap-3 sm:grid-cols-2">
      {items.map((item, i) => (
        <li
          key={item.title}
          className="animate-content-in min-w-0 rounded-xl border border-border bg-card p-3.5"
          style={{ animationDelay: `${i * 140}ms` }}
        >
          <p className="text-sm font-semibold text-foreground">{item.title}</p>
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{item.text}</p>
        </li>
      ))}
    </ul>
  )
}

const RENAME_TIMES = [1300, 3400]

/** Old names and places struck through, then the new ones arriving beside them. `pairs` is [[old, new], …]. */
export function Renames({ pairs }) {
  const [ref, phase] = useScene(RENAME_TIMES)
  const now = phase >= 1
  return (
    <ul ref={ref} className="min-w-0 space-y-2">
      {pairs.map(([before, after], i) => (
        <li key={before} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm">
          <span className={cn("text-muted-foreground transition-all duration-500", now && "line-through decoration-red-9/70")}>{before}</span>
          <ArrowRight size={14} aria-hidden="true" className={cn("text-muted-foreground transition-opacity duration-500", now ? "opacity-100" : "opacity-0")} />
          <span
            className="font-semibold text-foreground transition-all duration-500 ease-out-expo"
            style={{ opacity: now ? 1 : 0, transform: now ? "none" : "translateX(-6px)", transitionDelay: `${i * 120}ms` }}
          >
            {after}
          </span>
        </li>
      ))}
    </ul>
  )
}

/* ------------------------------------------------------------------ pieces to draw scenes with */

/** A window drawn small: a title row, an optional address bar, and the body. */
export function MockWindow({ title, address, children, className }) {
  return (
    <div className={cn("min-w-0 overflow-hidden rounded-xl border border-border bg-card shadow-sm", className)}>
      {address !== undefined && (
        <div className="flex items-center gap-2 border-b border-border bg-muted/60 px-3 py-1.5">
          <span className="size-2 shrink-0 rounded-full bg-mauve-7" />
          <span className="min-w-0 truncate rounded-md bg-card px-2 py-0.5 font-mono text-[11px] text-muted-foreground transition-colors duration-300">
            {address}
          </span>
        </div>
      )}
      {title && <div className="border-b border-border px-3 py-2 text-xs font-semibold text-foreground">{title}</div>}
      <div className="min-w-0 p-3">{children}</div>
    </div>
  )
}

/** Something drawn to look like a button. It is a picture: the real buttons are on the real screens. */
export function MockButton({ children, tone = "outline", pressed = false, off = false, className }) {
  return (
    <span
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium whitespace-nowrap transition-all duration-200",
        tone === "primary" && "bg-primary-action text-primary-foreground",
        tone === "dark" && "bg-foreground text-background",
        tone === "outline" && "border border-border bg-background text-foreground",
        tone === "ghost" && "text-muted-foreground",
        pressed && "translate-y-px scale-95",
        off && "opacity-45",
        className,
      )}
    >
      {children}
    </span>
  )
}

/** A field drawn small: its label, the box, and what the screen said under it. */
export function MockField({ label, value, placeholder, required = false, error, bubble, className }) {
  return (
    <div className={cn("relative min-w-0", className)}>
      <div className="mb-1 text-[11px] font-semibold text-muted-foreground">
        {label}
        {required && <span className="ml-0.5 text-red-11">*</span>}
      </div>
      <div
        className={cn(
          "flex h-8 items-center rounded-lg border bg-background px-2.5 text-xs transition-colors duration-300",
          error ? "border-red-9 ring-2 ring-red-a4" : "border-border",
          value ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {value || placeholder || ""}
      </div>
      {error && <div className="animate-slide-down mt-1 text-[11px] font-medium text-red-11">{error}</div>}
      {bubble && (
        <div className="animate-slide-down absolute top-full left-2 z-10 mt-1 flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-[11px] text-foreground shadow-lg">
          <span className="flex size-4 items-center justify-center rounded-sm bg-amber-9 text-[10px] font-bold text-white">!</span>
          {bubble}
        </div>
      )}
    </div>
  )
}

/** A pointer that glides to `x`/`y` (percent of the scene) and shows a ring when it clicks. */
export function Cursor({ x, y, clicking = false, hidden = false }) {
  return (
    <span
      className={cn("pointer-events-none absolute z-20 transition-all duration-700 ease-out-expo", hidden && "opacity-0")}
      style={{ left: `${x}%`, top: `${y}%` }}
    >
      {clicking && <span className="absolute -top-2 -left-2 size-5 animate-ping rounded-full bg-mauve-a7" />}
      <MousePointer2 size={18} className="fill-foreground text-background drop-shadow" />
    </span>
  )
}

/** A short message drawn over a scene, like the app's toasts. */
export function MockToast({ show, children, tone = "plain" }) {
  return (
    <div
      className={cn(
        "absolute right-3 bottom-3 left-3 z-10 rounded-lg border bg-card px-3 py-2 text-xs shadow-lg transition-all duration-300 sm:left-auto sm:max-w-[16rem]",
        tone === "error" ? "border-red-7 text-red-11" : "border-border text-foreground",
        show ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-2 opacity-0",
      )}
    >
      {children}
    </div>
  )
}

/** Grey bars standing in for text the scene does not need to spell out. */
export function Lines({ n = 2, className }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="h-2 rounded-full bg-mauve-4" style={{ width: `${88 - i * 18}%` }} />
      ))}
    </div>
  )
}
