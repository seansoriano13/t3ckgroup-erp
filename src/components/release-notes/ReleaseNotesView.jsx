import { useEffect, useId, useState } from "react"
import { ErrorBoundary } from "react-error-boundary"
import { Check, ChevronRight, Eye, Image as ImageIcon, MousePointerClick } from "lucide-react"
import { Button } from "@/components/ui/button"
import BetaTag from "@/components/ui/BetaTag"
import SectionHeader from "@/components/ui/SectionHeader"
import { cn } from "@/lib/utils"
import StatusBadge from "../StatusBadge"
import SampleProvider from "./SampleProvider"
import { SAMPLES, SAMPLE_MODE } from "./sampleRegistry"

/**
 * Release Notes (ADR 0030 and its 2026-11 amendment): an Overview of every
 * change as one line, and one tab per area where each change is a folded row
 * that opens to its text and the real screen fed Sample Data. A row's sample
 * mounts only once the row is opened.
 *
 * Throwaway code: it serves one release's content.js and nothing else. Never
 * bend a real component to keep a sample here working; delete the sample.
 */

const isFix = (item) => item.kind === "fix"

function WhoChips({ who }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {who.map((w) => (
        <span key={w} className="rounded-full border border-border bg-card px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          {w}
        </span>
      ))}
    </span>
  )
}

function SampleBroken() {
  return <p className="text-sm text-muted-foreground">This example could not be shown.</p>
}

// Readers skim past a screen that looks like a picture, so a live one says it
// can be played with; a locked one or a screenshot says it cannot.
const SAMPLE_HINT = {
  live: {
    Icon: MousePointerClick,
    label: "Try it: click, type, drag",
    tone: "bg-blue-a3 text-blue-11",
    caption: "Sample data: the real screen, filled with made-up people and figures. Nothing you do here is saved.",
  },
  look: {
    Icon: Eye,
    label: "Look only",
    tone: "bg-muted text-muted-foreground",
    caption: "Sample data: the real screen, filled with made-up people and figures, locked so it only shows.",
  },
  pictures: {
    Icon: ImageIcon,
    label: "Screenshots",
    tone: "bg-muted text-muted-foreground",
    caption: "Screenshots from the app, before and after the fix.",
  },
}

function SampleFrame({ name }) {
  const Sample = SAMPLES[name]
  if (!Sample) return null
  const { Icon, label, tone, caption } = SAMPLE_HINT[SAMPLE_MODE[name] ?? "live"]
  return (
    <figure className="min-w-0 space-y-2">
      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${tone}`}>
        <Icon size={14} aria-hidden="true" />
        {label}
      </span>
      <div className="min-w-0 overflow-x-auto rounded-2xl border border-border bg-muted/30 p-4 sm:p-5">
        <ErrorBoundary FallbackComponent={SampleBroken}>
          {/* Every sample gets a sandbox, even one that reads nothing: a
              component that does not seed its own would otherwise fall back
              to the app's real query client. */}
          <SampleProvider>
            <Sample />
          </SampleProvider>
        </ErrorBoundary>
      </div>
      <figcaption className="text-xs text-muted-foreground">{caption}</figcaption>
    </figure>
  )
}

/**
 * The open and close of a row, with the app's `.reveal` (index.css). The body
 * mounts the first time the row opens and stays mounted, so closing has
 * something to animate from; it opens one frame after mounting, so the
 * browser has a height to animate to.
 */
function Reveal({ open, id, children }) {
  const [rendered, setRendered] = useState(open)
  if (open && !rendered) setRendered(true)
  const [shown, setShown] = useState(open)
  const [settledFor, setSettledFor] = useState(open)

  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(open))
    return () => cancelAnimationFrame(frame)
  }, [open])

  return (
    <div
      className="reveal"
      data-open={shown}
      data-settled={settledFor === shown}
      onTransitionEnd={(event) => {
        if (event.target === event.currentTarget) setSettledFor(shown)
      }}
    >
      <div id={id} inert={!open} className="min-w-0">
        <div className="reveal-body min-w-0 space-y-4 border-t border-border px-4 pt-4 pb-6 sm:px-5">
          {rendered ? children : null}
        </div>
      </div>
    </div>
  )
}

function Row({ item, open, onToggle }) {
  const panelId = useId()
  return (
    <li id={item.id} className="min-w-0 scroll-mt-24">
      <h3>
        <Button
          type="button"
          variant="ghost"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={panelId}
          className="h-auto w-full min-w-0 justify-start gap-3 rounded-none px-4 py-3.5 text-left font-normal whitespace-normal hover:bg-muted/50 sm:px-5"
        >
          <span className="flex min-w-0 flex-1 flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
            <span className="min-w-0 flex-1 text-[15px] font-semibold text-foreground">{item.title}</span>
            <span className="flex shrink-0 flex-wrap items-center gap-1.5">
              {item.kind === "removed" && <StatusBadge label="Removed" theme="amber" />}
              <WhoChips who={item.who} />
            </span>
          </span>
          <ChevronRight
            size={16}
            aria-hidden="true"
            className={cn("shrink-0 text-muted-foreground transition-transform duration-200 ease-out-expo", open && "rotate-90")}
          />
        </Button>
      </h3>
      <Reveal open={open} id={panelId}>
        <p className="max-w-3xl text-pretty text-[15px] leading-relaxed text-muted-foreground">{item.body}</p>
        {item.sample && <SampleFrame name={item.sample} />}
      </Reveal>
    </li>
  )
}

function RowGroup({ title, items, openIds, onToggle }) {
  if (items.length === 0) return null
  return (
    <section className="space-y-2" aria-label={title}>
      <h2 className="text-sm font-semibold text-muted-foreground">{title}</h2>
      {/* No overflow-hidden: it would clip the focus ring of the row headers. */}
      <ul className="divide-y divide-border rounded-xl border border-border bg-card">
        {items.map((item) => (
          <Row key={item.id} item={item} open={openIds.has(item.id)} onToggle={() => onToggle(item.id)} />
        ))}
      </ul>
    </section>
  )
}

/**
 * One area tab. `defaultOpen` is the id of the row to open (and scroll to)
 * on arrival, "also-fixed" to scroll to that list, or "all".
 */
export default function ReleaseNotesSection({ section, defaultOpen }) {
  const allIds = section.items.map((i) => i.id)
  const [openIds, setOpenIds] = useState(
    () => new Set(defaultOpen === "all" ? allIds : allIds.filter((id) => id === defaultOpen)),
  )
  const toggle = (id) =>
    setOpenIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  useEffect(() => {
    if (!defaultOpen || defaultOpen === "all") return
    const frame = requestAnimationFrame(() => document.getElementById(defaultOpen)?.scrollIntoView?.({ block: "start" }))
    return () => cancelAnimationFrame(frame)
  }, [defaultOpen])

  const added = section.items.filter((i) => !isFix(i))
  const fixed = section.items.filter(isFix)

  return (
    <div className="min-w-0 space-y-8 pb-16">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <p className="flex max-w-3xl flex-wrap items-center gap-2 text-[15px] text-muted-foreground">
          {section.beta && <BetaTag />}
          <span>{section.intro}</span>
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setOpenIds(new Set(allIds))} disabled={openIds.size >= allIds.length}>
            Open all
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setOpenIds(new Set())} disabled={openIds.size === 0}>
            Close all
          </Button>
        </div>
      </div>
      <RowGroup title="New" items={added} openIds={openIds} onToggle={toggle} />
      <RowGroup title="Fixed" items={fixed} openIds={openIds} onToggle={toggle} />
      {section.alsoFixed?.length > 0 && (
        <section id="also-fixed" className="scroll-mt-24 space-y-3">
          <SectionHeader title="Also fixed" />
          <ul className="max-w-3xl space-y-2">
            {section.alsoFixed.map((line) => (
              <li key={line} className="flex gap-2.5 text-[15px] leading-relaxed text-foreground">
                <Check size={16} className="mt-1 shrink-0 text-green-11" aria-hidden="true" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

function OverviewLine({ children, onClick }) {
  return (
    <li className="flex items-baseline gap-2.5">
      <span aria-hidden="true" className="size-1.5 shrink-0 translate-y-[-2px] rounded-full bg-mauve-8" />
      <Button
        type="button"
        variant="link"
        onClick={onClick}
        className="h-auto justify-start p-0 text-left text-[15px] font-normal whitespace-normal text-foreground"
      >
        {children}
      </Button>
    </li>
  )
}

/**
 * The first tab: every change in the release as one line, grouped by area.
 * A line opens its row in the area tab; `onOpen(tabKey, rowId)`.
 */
export function ReleaseNotesOverview({ sections, onOpen }) {
  return (
    <div className="min-w-0 space-y-6 pb-16">
      <p className="max-w-3xl text-[15px] text-muted-foreground">
        Every change in this release, one line each. Click a line to read more and, for most, try the real screen.
      </p>
      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        {sections.map((section) => {
          const added = section.items.filter((i) => !isFix(i))
          const fixes = section.items.filter(isFix).length + (section.alsoFixed?.length ?? 0)
          return (
            <section key={section.key} aria-label={section.label} className="min-w-0 space-y-3 rounded-xl border border-border bg-card p-4 sm:p-5">
              <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
                {section.label}
                {section.beta && <BetaTag />}
              </h2>
              <ul className="space-y-1.5">
                {added.map((item) => (
                  <OverviewLine key={item.id} onClick={() => onOpen(section.key, item.id)}>
                    {item.title}
                  </OverviewLine>
                ))}
              </ul>
              {fixes > 0 && (
                <Button
                  type="button"
                  variant="link"
                  onClick={() => onOpen(section.key, section.items.find(isFix)?.id ?? "also-fixed")}
                  className="h-auto gap-1.5 p-0 text-sm font-medium text-muted-foreground"
                >
                  <Check size={14} className="text-green-11" aria-hidden="true" />
                  {`and ${plural(fixes, "fix", "fixes")}`}
                </Button>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}
