import { Check } from "lucide-react";
import { Button } from "./button";
import Avatar from "../Avatar";
import { useEmployeeAvatarMap } from "../../hooks/useEmployeeAvatarMap";
import { formatDate } from "../../utils/formatDate.js";
import { CAPTION_BASE } from "@/lib/captionStyle";

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
              {s.state === "current" && <span className={`ml-2 rounded-full bg-blue-3 px-1.5 py-0.5 ${CAPTION_BASE} tracking-wider text-blue-11`}>Now</span>}
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

export function DetailSection({ title, aside, children }) {
  return (
    <section>
      <h3 className={`mb-2 flex items-center gap-1.5 ${CAPTION_BASE} tracking-wider text-muted-foreground`}>
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
export function PersonChip({ person, size = "sm", detail }) {
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
