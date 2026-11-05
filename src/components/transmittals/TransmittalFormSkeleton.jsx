/**
 * The Raise a Transmittal window while its checks and lists are still loading (#904).
 * Grey bars sit where the slip's properties and the lines will be, so the window
 * shows its shape at once instead of a spinner over an empty panel.
 */
export default function TransmittalFormSkeleton() {
  return (
    <div role="status" aria-label="Loading Transmittal form" className="space-y-5">
      <span className="sr-only">Loading Transmittal form…</span>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="space-y-2">
            <div className="h-3 w-20 animate-pulse rounded-md bg-muted/70" />
            <div className="h-10 w-full animate-pulse rounded-lg bg-muted" />
          </div>
        ))}
      </div>
      <div className="space-y-2 rounded-xl border border-border bg-card p-3">
        <div className="h-9 w-full animate-pulse rounded-md bg-muted/70" />
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="h-8 w-full animate-pulse rounded-md bg-muted/50" />
        ))}
      </div>
    </div>
  );
}
