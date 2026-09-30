import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import Avatar from "../../../components/Avatar";
import { useEmployeeAvatarMap } from "../../../hooks/useEmployeeAvatarMap";
import { formatDate } from "../../../utils/formatDate.js";
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

/** The approval chain as a vertical stepper, the reviewer's own step marked "Now". */
export function ApprovalChain({ chain }) {
  return (
    <ol>
      {chain.map((s, i) => (
        <li key={s.label} className="relative flex gap-3 pb-5 last:pb-0">
          {i < chain.length - 1 && <span className={`absolute left-[11px] top-6 h-[calc(100%-20px)] w-px ${s.state === "done" ? "bg-mauve-9" : "bg-border"}`} />}
          <span
            className={`relative z-10 grid size-6 shrink-0 place-items-center rounded-full border text-[10px] font-bold ${
              s.state === "done"
                ? "border-mauve-12 bg-mauve-12 text-mauve-1"
                : s.state === "current"
                  ? "border-blue-9 bg-blue-3 text-blue-11 ring-4 ring-blue-3/60"
                  : "border-border bg-card text-muted-foreground"
            }`}
          >
            {s.state === "done" ? <Check size={12} strokeWidth={3} /> : i + 1}
          </span>
          <div className="min-w-0 pt-0.5">
            <p className={`text-[13px] font-semibold ${s.state === "next" ? "text-muted-foreground" : "text-foreground"}`}>
              {s.label}
              {s.state === "current" && <span className="ml-2 rounded-full bg-blue-3 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-blue-11">Now</span>}
            </p>
            <p className="text-xs text-muted-foreground">
              {s.who}
              {s.note ? ` · ${s.note}` : ""}
              {s.at ? ` · ${formatDate(s.at)}` : ""}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** One-click remark presets; each appends to whatever is already written. */
export function NotePresets({ presets, onPick }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {presets.map((q) => (
        <Button
          key={q}
          type="button"
          variant="ghost"
          size="xs"
          className="h-7 rounded-full bg-card px-3 text-xs font-medium text-muted-foreground ring-1 ring-border hover:text-foreground"
          onClick={() => onPick(q)}
        >
          {q}
        </Button>
      ))}
    </div>
  );
}

export function SheetSection({ title, aside, children }) {
  return (
    <section>
      <h3 className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        {title}
        {aside}
      </h3>
      {children}
    </section>
  );
}

/** A label/value row inside the sheet's Details list. */
export function DetailRow({ label, children }) {
  return (
    <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 py-2 text-[13px]">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 font-medium text-foreground">{children || "—"}</dd>
    </div>
  );
}

/** Avatar + name + department, resolving the photo the same way every queue does. */
export function Person({ person, size = "sm", detail }) {
  const avatarMap = useEmployeeAvatarMap();
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Avatar name={person.name} src={avatarMap.get(person.id) || person.avatarPath} size={size} />
      <div className="min-w-0">
        <p className="truncate text-[13px] font-medium text-foreground">{person.name}</p>
        {(detail ?? person.dept) && <p className="truncate text-[11px] text-muted-foreground">{detail ?? person.dept}</p>}
      </div>
    </div>
  );
}
