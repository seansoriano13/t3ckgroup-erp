/**
 * Side-by-side shell for a before/after demo.
 *
 * The "before" panel is a replica built from the source at 9655097, not the
 * old component resurrected — so it has to be unmistakably the past from
 * across a room. It is desaturated and dimmed; the "after" panel is in full
 * colour and carries the link to the real screen on staging.
 */
function Panel({ side, label, children }) {
  const isBefore = side === "before"
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3">
      <div className="flex items-center gap-2">
        <span
          className={
            isBefore
              ? "rounded-full bg-muted px-3 py-1 text-[13px] font-semibold text-muted-foreground"
              : "rounded-full bg-emerald-500/15 px-3 py-1 text-[13px] font-semibold text-emerald-700 dark:text-emerald-300"
          }
        >
          {label}
        </span>
      </div>
      <div
        className={
          isBefore
            ? "flex-1 rounded-2xl border border-border bg-card p-5 opacity-70 grayscale"
            : "flex-1 rounded-2xl border-2 border-emerald-500/30 bg-card p-5 shadow-sm"
        }
      >
        {children}
      </div>
    </div>
  )
}

export default function BeforeAfter({ before, after, liveHref, note }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-stretch">
        <Panel side="before" label="Before · Sep 9">
          {before}
        </Panel>
        <Panel side="after" label="Now · on staging">
          {after}
        </Panel>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {note ? <p className="text-[15px] text-muted-foreground">{note}</p> : <span />}
        {liveHref && (
          <a
            href={liveHref}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 rounded-xl border border-border bg-card px-4 py-2 text-[14px] font-semibold text-foreground transition-colors hover:bg-muted"
          >
            Open it live →
          </a>
        )}
      </div>
    </div>
  )
}

/** Fake window chrome, so a replica reads as a screen rather than a diagram. */
export function Chrome({ title, children }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <div className="flex items-center gap-2 border-b border-border bg-muted/60 px-3 py-2">
        <span className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </span>
      </div>
      <div className="p-3">{children}</div>
    </div>
  )
}
