import { useCallback, useEffect, useMemo, useState } from "react"
import { navigate, sectionSizes, positionLabel, SECTIONS } from "../../utils/presentationDeck"
import { DEMOS } from "./demoRegistry"

/**
 * The Release Notes deck.
 *
 * Driven from a keyboard on a TV: left/right walk the deck, up/down jump
 * between sections, O opens an overview. Everything it renders comes from
 * src/data/presentation.json, baked at build time — this component makes no
 * network call of its own (ADR 0022).
 */

function Kbd({ children }) {
  return (
    <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[12px] font-semibold text-muted-foreground">
      {children}
    </kbd>
  )
}

function IssueRefs({ issues }) {
  if (!issues?.length) return null
  return (
    <p className="text-[13px] font-medium text-muted-foreground">
      {issues.map((n) => `#${n}`).join(" · ")}
    </p>
  )
}

/* ── Section 1 — what shipped ───────────────────────────────────────────── */

function HeadlineSlide({ row }) {
  const [open, setOpen] = useState(false)
  const Demo = row.demo ? DEMOS[row.demo] : null

  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-3">
        <span className="inline-block rounded-full bg-muted px-3 py-1 text-[13px] font-bold uppercase tracking-wide text-muted-foreground">
          {row.block}
        </span>
        <h2 className="text-balance text-4xl font-bold leading-tight text-foreground lg:text-5xl">
          {row.title}
        </h2>
        <p className="max-w-4xl text-pretty text-lg leading-relaxed text-muted-foreground lg:text-xl">
          {row.impact}
        </p>
      </div>

      {Demo && <Demo />}

      <div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded-xl border border-border bg-card px-4 py-2 text-[14px] font-semibold text-foreground transition-colors hover:bg-muted"
        >
          {open ? "Hide the detail" : `What changed exactly (${row.changes.length})`}
        </button>
        {open && (
          <ul className="mt-3 max-w-4xl space-y-2">
            {row.changes.map((c) => (
              <li
                key={c}
                className="flex gap-2.5 text-[15px] leading-relaxed text-foreground"
              >
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground" />
                <span>{c}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3">
          <IssueRefs issues={row.issues} />
        </div>
      </div>
    </div>
  )
}

/* ── Section 2 — under the hood ─────────────────────────────────────────── */

function UnderTheHoodSlide({ data }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-3">
        <h2 className="text-4xl font-bold leading-tight text-foreground lg:text-5xl">
          {data.items.length} fixes and safety changes
        </h2>
        <p className="max-w-4xl text-pretty text-lg leading-relaxed text-muted-foreground lg:text-xl">
          {data.summary}
        </p>
      </div>
      <div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded-xl border border-border bg-card px-4 py-2 text-[14px] font-semibold text-foreground transition-colors hover:bg-muted"
        >
          {open ? "Hide the list" : "Show the list"}
        </button>
        {open && (
          <ul className="mt-4 grid max-w-6xl gap-2.5 lg:grid-cols-2">
            {data.items.map((item) => (
              <li
                key={item.title}
                className="rounded-xl border border-border bg-card px-4 py-3 text-[15px] leading-relaxed text-foreground"
              >
                {item.title}
                <span className="mt-1 block text-[13px] font-medium text-muted-foreground">
                  {item.issues.map((n) => `#${n}`).join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

/* ── Section 3 — what's left ────────────────────────────────────────────── */

function EpicRow({ epic }) {
  const [open, setOpen] = useState(false)
  const pct = epic.total === 0 ? 0 : Math.round((epic.done / epic.total) * 100)

  return (
    <li className="rounded-xl border border-border bg-card p-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start justify-between gap-4 text-left"
      >
        <span className="min-w-0">
          <span className="block text-[17px] font-bold text-foreground">
            {epic.title}
          </span>
          <span className="mt-1 block text-[14px] leading-relaxed text-muted-foreground">
            {epic.unlocks}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className="block text-[20px] font-bold tabular-nums text-foreground">
            {epic.done} / {epic.total}
          </span>
          <span className="block text-[12px] font-semibold uppercase text-muted-foreground">
            #{epic.number}
          </span>
        </span>
      </button>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-emerald-500/70"
          style={{ width: `${pct}%` }}
        />
      </div>
      {open && (
        <ul className="mt-3 space-y-1.5">
          {epic.tickets.map((t) => (
            <li key={t.number} className="flex items-baseline gap-2 text-[14px]">
              <span className="w-14 shrink-0 font-semibold tabular-nums text-muted-foreground">
                #{t.number}
              </span>
              <span
                className={
                  t.open && !t.shipped ? "text-foreground" : "text-muted-foreground"
                }
              >
                {t.title ?? "(closed)"}
              </span>
              {t.shipped && (
                <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-bold uppercase text-emerald-700 dark:text-emerald-300">
                  shipped · ticket still open
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

function RoadmapSlide({ phase, index, total, roadmap }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-2">
        <span className="inline-block rounded-full bg-muted px-3 py-1 text-[13px] font-bold uppercase tracking-wide text-muted-foreground">
          Phase {index + 1} of {total}
        </span>
        <h2 className="text-4xl font-bold leading-tight text-foreground lg:text-5xl">
          {phase.name}
        </h2>
        <p className="text-lg text-muted-foreground">
          {roadmap.openCount} tickets open across the whole roadmap, in {roadmap.epicCount}{" "}
          epics. No dates on this screen on purpose.
        </p>
      </div>
      <ul className="grid max-w-6xl gap-3">
        {phase.epics.map((epic) => (
          <EpicRow key={epic.number} epic={epic} />
        ))}
      </ul>
    </div>
  )
}

/* ── Section 4 — coming next ────────────────────────────────────────────── */

function PrototypeSlide({ prototype }) {
  const [variant, setVariant] = useState(prototype.variants[0])

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1.5">
          <span className="inline-block rounded-full bg-amber-500/15 px-3 py-1 text-[13px] font-bold uppercase tracking-wide text-amber-800 dark:text-amber-200">
            Paper mock-up · nothing built behind it
          </span>
          <h2 className="text-3xl font-bold text-foreground lg:text-4xl">
            {prototype.title}
          </h2>
          <p className="max-w-3xl text-[15px] text-muted-foreground">{prototype.note}</p>
        </div>
        <div className="flex items-center gap-1.5">
          {prototype.variants.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setVariant(v)}
              className={`h-10 w-10 rounded-xl border text-[15px] font-bold transition-colors ${
                variant === v
                  ? "border-foreground bg-muted text-foreground"
                  : "border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              {v}
            </button>
          ))}
          <a
            href={`${prototype.file}?variant=${variant}`}
            target="_blank"
            rel="noreferrer"
            className="ml-1.5 rounded-xl border border-border bg-card px-3 py-2 text-[14px] font-semibold hover:bg-muted"
          >
            Full screen →
          </a>
        </div>
      </div>
      <iframe
        key={`${prototype.id}-${variant}`}
        title={`${prototype.title} — treatment ${variant}`}
        src={`${prototype.file}?variant=${variant}`}
        className="min-h-[460px] w-full flex-1 rounded-2xl border border-border bg-white"
      />
    </div>
  )
}

/* ── Overview ───────────────────────────────────────────────────────────── */

function Overview({ data, sizes, onPick }) {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {SECTIONS.map((section, si) => (
        <div key={section.key} className="space-y-2">
          <h3 className="text-[13px] font-bold uppercase tracking-wide text-muted-foreground">
            {section.label} · {sizes[si]}
          </h3>
          <ul className="space-y-1">
            {Array.from({ length: sizes[si] }).map((_, ii) => {
              const label =
                si === 0
                  ? data.headline[ii].title
                  : si === 1
                    ? `${data.underTheHood.items.length} fixes and safety changes`
                    : si === 2
                      ? data.roadmap.phases[ii].name
                      : data.prototypes[ii].title
              return (
                <li key={`${section.key}-${ii}`}>
                  <button
                    type="button"
                    onClick={() => onPick({ section: si, item: ii })}
                    className="w-full rounded-lg px-2.5 py-1.5 text-left text-[15px] font-medium text-foreground hover:bg-muted"
                  >
                    {label}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </div>
  )
}

/* ── Shell ──────────────────────────────────────────────────────────────── */

export default function PresentationDeck({ data }) {
  // Derived from a file baked at build time, so it is stable for the life of
  // the page — memoised so the keydown listener is not torn down and
  // re-attached on every render.
  const sizes = useMemo(() => sectionSizes(data), [data])
  // A section can be empty (a deck generated before any prototype existed, or
  // with an empty window), so open on the first section that renders anything
  // rather than assuming section 0 has slides.
  const [pos, setPos] = useState(() => ({
    section: sizes.findIndex((n) => n > 0),
    item: 0,
  }))
  const [overview, setOverview] = useState(false)

  const onKey = useCallback(
    (event) => {
      const tag = event.target?.tagName
      if (tag === "INPUT" || tag === "TEXTAREA" || event.target?.isContentEditable) return

      if (event.key === "o" || event.key === "O") {
        event.preventDefault()
        setOverview((v) => !v)
        return
      }
      if (event.key === "Escape") {
        setOverview(false)
        return
      }
      if (overview) return

      const next = navigate(pos, event.key, sizes)
      if (next !== pos) {
        event.preventDefault()
        setPos(next)
      }
    },
    // `sizes` is derived fresh each render from a frozen build-time file, so
    // it never changes identity in a way that matters here.
    [pos, overview, sizes],
  )

  useEffect(() => {
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onKey])

  const generated = new Date(data.generatedAt)

  if (pos.section === -1) {
    return (
      <p className="p-8 text-[15px] text-muted-foreground">
        Nothing to present yet — run <code>pnpm presentation</code> to generate the deck.
      </p>
    )
  }

  let slide = null
  if (pos.section === 0) slide = <HeadlineSlide key={data.headline[pos.item].id} row={data.headline[pos.item]} />
  else if (pos.section === 1) slide = <UnderTheHoodSlide data={data.underTheHood} />
  else if (pos.section === 2)
    slide = (
      <RoadmapSlide
        phase={data.roadmap.phases[pos.item]}
        index={pos.item}
        total={data.roadmap.phases.length}
        roadmap={data.roadmap}
      />
    )
  else slide = <PrototypeSlide key={data.prototypes[pos.item].id} prototype={data.prototypes[pos.item]} />

  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-[22px] font-bold text-foreground">{data.title}</h1>
          <span className="rounded-full bg-amber-500/15 px-3 py-1 text-[13px] font-semibold text-amber-800 dark:text-amber-200">
            Built and testable on staging — it goes live when we release
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[14px] font-bold tabular-nums text-foreground">
            {positionLabel(pos, sizes)}
          </span>
          <button
            type="button"
            onClick={() => setOverview((v) => !v)}
            className="rounded-xl border border-border bg-card px-3 py-1.5 text-[13px] font-semibold hover:bg-muted"
          >
            {overview ? "Close" : "Overview"}
          </button>
        </div>
      </header>

      <main className="flex-1">
        {overview ? (
          <Overview
            data={data}
            sizes={sizes}
            onPick={(next) => {
              setPos(next)
              setOverview(false)
            }}
          />
        ) : (
          slide
        )}
      </main>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3 text-[13px] text-muted-foreground">
        <span className="flex flex-wrap items-center gap-2">
          <Kbd>←</Kbd>
          <Kbd>→</Kbd> through · <Kbd>↑</Kbd>
          <Kbd>↓</Kbd> sections · <Kbd>O</Kbd> overview
        </span>
        <span>
          Since {data.since} · snapshot taken{" "}
          {generated.toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" })}
        </span>
      </footer>
    </div>
  )
}
