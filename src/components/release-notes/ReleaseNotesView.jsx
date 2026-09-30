import { useState } from "react"
import { ErrorBoundary } from "react-error-boundary"
import { Check, Eye, Image as ImageIcon, MousePointerClick } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ExternalLink } from "@/components/ui/external-link"
import SectionHeader from "@/components/ui/SectionHeader"
import StatusBadge from "../StatusBadge"
import SampleProvider from "./SampleProvider"
import { SAMPLES, SAMPLE_MODE } from "./sampleRegistry"

/**
 * One section of Release Notes (ADR 0030): each change as a title, a line or
 * two, who uses it, and — where it has one — the real screen fed Sample Data.
 * Only the open section is rendered, so only its samples mount.
 */

const KIND_BADGE = {
  fix: { label: "Fixed", theme: "green" },
  removed: { label: "Removed", theme: "amber" },
  next: { label: "Not built yet", theme: "amber" },
}

function WhoChips({ who }) {
  return (
    <ul className="flex flex-wrap items-center gap-1.5" aria-label="Who uses this">
      {who.map((w) => (
        <li key={w} className="rounded-full border border-border bg-card px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          {w}
        </li>
      ))}
    </ul>
  )
}

function SampleBroken() {
  return <p className="text-sm text-muted-foreground">This example could not be shown.</p>
}

// Readers skim past a screen that looks like a picture, so a live one says it
// can be played with; a locked one or a screenshot says it cannot, so no one
// clicks it, gets nothing, and stops trying the rest.
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

const isLive = (item) => item.sample && !SAMPLE_MODE[item.sample]

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

function PrototypeFrame({ prototypes }) {
  const [active, setActive] = useState(prototypes[0])
  const [variant, setVariant] = useState("A")
  const src = `${active.file}?variant=${variant}`

  return (
    <figure className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {prototypes.length > 1 ? (
          <div className="flex flex-wrap gap-1.5">
            {prototypes.map((p) => (
              <Button
                key={p.id}
                type="button"
                size="sm"
                variant={p.id === active.id ? "secondary" : "ghost"}
                aria-pressed={p.id === active.id}
                onClick={() => setActive(p)}
              >
                {p.title}
              </Button>
            ))}
          </div>
        ) : (
          <span className="text-sm font-semibold text-foreground">{active.title}</span>
        )}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Version</span>
          {["A", "B", "C"].map((v) => (
            <Button
              key={v}
              type="button"
              size="icon-sm"
              variant={v === variant ? "secondary" : "ghost"}
              aria-pressed={v === variant}
              aria-label={`Version ${v}`}
              onClick={() => setVariant(v)}
            >
              {v}
            </Button>
          ))}
          <ExternalLink href={src} target="_blank" rel="noreferrer" className="ml-1 text-xs font-semibold">
            Full screen
          </ExternalLink>
        </div>
      </div>
      <iframe
        key={src}
        title={`${active.title}, version ${variant}`}
        src={src}
        className="h-[560px] w-full rounded-2xl border border-border bg-white"
      />
      <figcaption className="text-xs text-muted-foreground">An early mock-up on paper. Nothing is built behind it yet.</figcaption>
    </figure>
  )
}

function Item({ item }) {
  const badge = KIND_BADGE[item.kind]
  return (
    <article id={item.id} className="min-w-0 scroll-mt-24 space-y-4 border-b border-border pb-10 last:border-b-0 last:pb-0">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {badge && <StatusBadge label={badge.label} theme={badge.theme} />}
          <WhoChips who={item.who} />
        </div>
        <h2 className="text-balance text-xl font-bold tracking-tight text-foreground">{item.title}</h2>
        <p className="max-w-3xl text-pretty text-[15px] leading-relaxed text-muted-foreground">{item.body}</p>
      </header>
      {item.sample && <SampleFrame name={item.sample} />}
      {item.prototypes && <PrototypeFrame prototypes={item.prototypes} />}
    </article>
  )
}

export default function ReleaseNotesSection({ section }) {
  return (
    <div className="min-w-0 space-y-10 pb-16">
      <div className="space-y-4">
        <p className="max-w-3xl text-[15px] text-muted-foreground">{section.intro}</p>
        {section.items.some(isLive) && (
          <p className="flex max-w-3xl items-start gap-3 rounded-2xl bg-blue-a3 px-4 py-3 text-[15px] leading-relaxed text-blue-12">
            <MousePointerClick size={18} className="mt-0.5 shrink-0 text-blue-11" aria-hidden="true" />
            <span>
              <strong className="font-semibold">Go ahead and click around.</strong> The screens below are the real
              ones, filled with made-up data: open, type, drag and press anything you like. Nothing you do here is
              saved, and nothing can break.
            </span>
          </p>
        )}
      </div>
      {section.items.map((item) => (
        <Item key={item.id} item={item} />
      ))}
      {section.alsoFixed?.length > 0 && (
        <section className="space-y-3">
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
