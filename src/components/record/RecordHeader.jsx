import StatusBadge from "@/components/StatusBadge";
import { cn } from "@/lib/utils";

/**
 * The top of every Purchasing record window: the reference (mono, or a word)
 * and the name as the title, one state badge after it, one quiet line under it.
 *
 * `reference` is the number ("TG03_0007") or a word ("Direct"); `mono` (default
 * true) sets it in mono, pass false for a word. `badge` is `{ label, theme?,
 * status? }` for StatusBadge. `line` is the one quiet line (who prepared it and
 * when).
 */
export default function RecordHeader({ reference, name, badge, line, mono = true, className }) {
  return (
    <header className={cn("space-y-1", className)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="min-w-0 text-xl font-black tracking-tight text-foreground">
          {reference && <span className={cn(mono && "font-mono")}>{reference}</span>}
          {reference && name && <span>{" · "}</span>}
          {name && <span>{name}</span>}
        </h2>
        {badge && <StatusBadge label={badge.label} theme={badge.theme} status={badge.status} />}
      </div>
      {line && <p className="text-[13px] text-muted-foreground">{line}</p>}
    </header>
  );
}
