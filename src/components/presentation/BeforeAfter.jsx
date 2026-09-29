import { Image } from "../ui/image"

/**
 * Two panes, the same thing before and after a change. A fix described in
 * words alone is a claim; this is what the room checks it against.
 */
export default function BeforeAfter({ before, after, beforeNote, afterNote }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Pane label="Before" tone="bg-red-500/15 text-red-800 dark:text-red-200" note={beforeNote}>
        {before}
      </Pane>
      <Pane label="After" tone="bg-emerald-500/15 text-emerald-800 dark:text-emerald-200" note={afterNote}>
        {after}
      </Pane>
    </div>
  )
}

function Pane({ label, tone, note, children }) {
  return (
    <div className="min-w-0 space-y-2">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className={`rounded-full px-3 py-1 text-[13px] font-bold uppercase tracking-wide ${tone}`}>{label}</span>
        {note && <span className="text-[14px] text-muted-foreground">{note}</span>}
      </div>
      <div className="min-w-0 overflow-hidden rounded-xl border border-border bg-card">{children}</div>
    </div>
  )
}

/**
 * Screenshots taken from the app itself: "before" at the commit ahead of the
 * change, "after" at the commit that made it, same local data both times.
 * Used where the old screen no longer exists in the code to be rendered.
 */
export function ScreenshotPair({ name, before, after }) {
  const src = (when) => `/release-notes/before-after/${name}-${when}.png`
  return (
    <BeforeAfter
      beforeNote={before}
      afterNote={after}
      before={<Image src={src("before")} alt={`${name}, before: ${before}`} className="block h-auto w-full" />}
      after={<Image src={src("after")} alt={`${name}, after: ${after}`} className="block h-auto w-full" />}
    />
  )
}
