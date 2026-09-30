import { statusOf } from "./approvalUi";

const PILL = {
  pending: ["Pending", "border-blue-7 text-blue-11"],
  overdue: ["Overdue", "border-amber-7 text-amber-11"],
  approved: ["Approved", "border-green-7 text-green-11"],
  verified: ["Verified", "border-green-7 text-green-11"],
};

/** A StatusBadge-style outline pill: the row's state in one word. */
export function StatusPill({ item }) {
  const [label, tone] = PILL[statusOf(item)];
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full border bg-card px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${tone}`}>
      {label}
    </span>
  );
}

/** Where the request is in its chain, one segment per step, the current one filled. */
export function StageMeter({ chain }) {
  const at = chain.findIndex((s) => s.state === "current");
  return (
    <div className="min-w-0">
      <div className="flex gap-0.5" aria-hidden="true">
        {chain.map((s) => (
          <span key={s.label} className={`h-1 w-5 rounded-full ${s.state === "done" ? "bg-mauve-11" : s.state === "current" ? "bg-blue-9" : "bg-mauve-5"}`} />
        ))}
      </div>
      <p className="mt-1 truncate text-[11px] text-muted-foreground">{at >= 0 ? `${at + 1}/${chain.length} · ${chain[at].label}` : "Complete"}</p>
    </div>
  );
}

