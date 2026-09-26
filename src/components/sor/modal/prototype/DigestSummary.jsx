/**
 * REMOVE-BEFORE-PROD — SOR modal layout prototype. The one-glance summary
 * (from "Rail + summary", picked in round 3): where the deal stands in one
 * sentence, five numbers, what needs attention (each with a way to go fix
 * it), key facts, team, and the latest note. Exported as parts so the three
 * Summary layouts can compose it with the charts; the default export is
 * "Rail + summary"'s own arrangement.
 */
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import Avatar from "../../../Avatar";
import { useDigest } from "./useDigest";
import { LABEL, QuoteActions, detailRows, formatShort, showMoney, teamRows } from "./shared";

const TONE_DOT = { amber: "bg-amber-9", red: "bg-red-9", mauve: "bg-mauve-8" };

export function SectionTitle({ children, aside, className }) {
  return (
    <div className={cn("mb-2 flex items-baseline justify-between gap-3", className)}>
      <h3 className="text-sm font-black text-foreground">{children}</h3>
      {aside}
    </div>
  );
}

function Stat({ label, value, sub, tone }) {
  return (
    <div className="min-w-0 px-4 py-3">
      <dt className={LABEL}>{label}</dt>
      <dd className={cn("mt-1 truncate text-lg font-black tabular-nums", tone === "red" ? "text-red-11" : "text-foreground")}>{value}</dd>
      {sub && <p className="truncate text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

export function StatusLine({ p, dg }) {
  const m = dg.moves;
  const nextLine = m.isTerminal
    ? "Deals stop here."
    : p.moveDisabled
      ? p.moveDisabledReason
      : dg.blocked.length
        ? `Can't move on until ${dg.blocked.length === 1 ? "one thing is" : `${dg.blocked.length} things are`} done.`
        : m.isFlow && m.destinations.length
          ? `Ready to move to ${m.destinations.map((d) => d.label).join(" or ")}.`
          : "Ready to move on.";
  return (
    <section>
      <p className="text-xl font-black tracking-tight text-foreground">
        In {m.currentLabel}
        {dg.days != null && <span className="text-muted-foreground"> · {dg.days === 0 ? "since today" : `${dg.days} day${dg.days === 1 ? "" : "s"}`}</span>}
      </p>
      <p className={cn("mt-1 text-sm", dg.blocked.length && !m.isTerminal ? "font-semibold text-amber-11" : "text-muted-foreground")}>{nextLine}</p>
    </section>
  );
}

export function StatsBand({ p, dg, className }) {
  const note = dg.latestNote;
  return (
    <dl className={cn("grid grid-cols-2 divide-border/60 rounded-xl border border-border/70 bg-card sm:divide-x", showMoney(p) ? "sm:grid-cols-5" : "sm:grid-cols-4", className)}>
      {showMoney(p) && <Stat label="Estimated value" value={p.ctx.estimatedValueDisplay} sub={p.opportunity.sales_reference || "No Sales Reference"} />}
      <Stat label="Products" value={dg.itemsCount} sub={showMoney(p) && dg.itemsCount ? dg.itemsTotal : "lines"} />
      <Stat label="Open tasks" value={dg.openTasks.length} sub={dg.overdueTasks.length ? `${dg.overdueTasks.length} past due` : "on this stage"} tone={dg.overdueTasks.length ? "red" : undefined} />
      <Stat
        label="Next follow-up"
        value={dg.followUpDue ? formatShort(dg.followUpDue) : "—"}
        sub={dg.followUpDue ? (dg.followUpOverdue ? "overdue" : "reminder") : "no cadence"}
        tone={dg.followUpOverdue ? "red" : undefined}
      />
      <Stat label="Notes" value={p.notes.length} sub={note ? `last ${formatShort(note.created_at)}` : "none yet"} />
    </dl>
  );
}

/** `go(target)` gets "now" | "items" | "details"; a caller without a Details view maps "details" itself. */
export function AttentionList({ dg, go }) {
  return (
    <section>
      <SectionTitle>Needs attention</SectionTitle>
      {dg.attention.length === 0 ? (
        <p className="flex items-center gap-2 rounded-xl border border-green-6 bg-green-2 px-4 py-3 text-sm font-semibold text-green-11">
          <CheckCircle2 size={15} /> Nothing needs attention right now.
        </p>
      ) : (
        <ul className="divide-y divide-border/60 rounded-xl border border-border/70 bg-card">
          {dg.attention.map((a) => (
            <li key={a.key} className="flex items-center gap-3 px-4 py-2.5">
              <span className={cn("size-2 shrink-0 rounded-full", TONE_DOT[a.tone])} />
              <span className="min-w-0 flex-1 text-[13px] font-medium text-foreground">{a.text}</span>
              {a.go && (
                <Button type="button" variant="ghost" size="xs" onClick={() => go(a.go)} className="shrink-0 gap-1 text-muted-foreground hover:text-foreground">
                  Go
                  <ArrowRight size={12} />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function KeyFacts({ p, cols = 2 }) {
  return (
    <section>
      <SectionTitle>Key facts</SectionTitle>
      <dl className={cn("grid gap-x-6 gap-y-3", cols === 3 ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-2")}>
        {detailRows(p).map((r) => (
          <div key={r.label} className="min-w-0">
            <dt className={LABEL}>{r.label}</dt>
            <dd className="mt-0.5 truncate text-[13px] font-semibold text-foreground">{r.value || <span className="text-muted-foreground/60">—</span>}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function TeamAndQuote({ p }) {
  const { people } = teamRows(p.opportunity);
  return (
    <section className="space-y-4">
      <div>
        <SectionTitle>Deal team</SectionTitle>
        {people.length === 0 ? (
          <p className="text-sm text-muted-foreground">No one assigned yet.</p>
        ) : (
          <ul className="space-y-2">
            {people.map(({ person, roles }) => (
              <li key={person.id} className="flex items-center gap-2">
                <Avatar name={person.name} src={person.avatar_path} size="xs" />
                <span className="truncate text-[13px] font-semibold text-foreground">{person.name}</span>
                <span className="truncate text-[11px] text-muted-foreground">{roles.join(" · ")}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <QuoteActions p={p} stacked={false} />
    </section>
  );
}

export function LatestNote({ dg, openNotes }) {
  const note = dg.latestNote;
  if (!note) return null;
  return (
    <section className="flex items-start gap-3 rounded-xl border border-border/70 bg-card px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-muted-foreground">
          Latest note · <span className="font-semibold">{note.author?.name || "System"}</span> · {formatShort(note.created_at)}
        </p>
        <p className="line-clamp-2 text-[13px] text-foreground">{note.content || note.metadata?.changes?.join(" · ") || "Attachment"}</p>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={openNotes} className="shrink-0">
        Open notes
      </Button>
    </section>
  );
}

export default function DigestSummary({ p, go, openNotes }) {
  const dg = useDigest(p);
  return (
    <div className="mx-auto max-w-4xl space-y-7 p-6">
      <StatusLine p={p} dg={dg} />
      <StatsBand p={p} dg={dg} />
      <AttentionList dg={dg} go={go} />
      <div className="grid gap-7 md:grid-cols-5">
        <div className="md:col-span-3">
          <KeyFacts p={p} />
        </div>
        <div className="md:col-span-2">
          <TeamAndQuote p={p} />
        </div>
      </div>
      <LatestNote dg={dg} openNotes={openNotes} />
    </div>
  );
}
