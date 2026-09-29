/**
 * REMOVE-BEFORE-PROD — layout "Summary · report". The same picks as the other
 * two Summary layouts, set as one printed-looking page: a single sheet
 * on the desk, sections divided by rules rather than boxed in cards, so the
 * Summary reads as one summary instead of a board of widgets. Sibling views in
 * the crumb, as "Summary · two columns".
 */
import { cn } from "@/lib/utils";
import NestedShell from "../summary/NestedShell";
import { AttentionList, KeyFacts, LatestNote, StatsBand, StatusLine, TeamAndQuote } from "../summary/DigestSummary";
import { MoneyBars, StageTimeChart } from "../summary/SummaryCharts";
import { useJourneyVisits } from "../summary/StageStrip";
import { useDigest } from "../summary/useDigest";
import { showMoney } from "../summary/shared";

function Part({ title, aside, className, children }) {
  return (
    <section className={cn("px-7 py-6", className)}>
      {title && (
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <h3 className="text-[15px] font-black tracking-tight text-foreground">{title}</h3>
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

function Summary({ p, go, open, openNotes }) {
  const dg = useDigest(p);
  const visits = useJourneyVisits(p);
  return (
    <div className="min-h-full bg-mauve-2 px-6 py-6">
      <article className="mx-auto max-w-5xl overflow-hidden rounded-xl border border-border/70 bg-card">
        <Part className="space-y-5">
          <StatusLine p={p} dg={dg} />
          <StatsBand p={p} dg={dg} className="bg-mauve-2" />
        </Part>

        <div className="grid divide-border/60 border-t border-border/60 md:grid-cols-12 md:divide-x">
          <Part className="md:col-span-5">
            <AttentionList dg={dg} go={go} />
          </Part>
          <Part
            title={showMoney(p) ? "Where the money is" : "What's being quoted"}
            aside={showMoney(p) && dg.itemsCount > 0 && <span className="text-xs font-semibold tabular-nums text-muted-foreground">{dg.itemsTotal}</span>}
            className="md:col-span-7"
          >
            <MoneyBars p={p} onOpen={() => open("items")} />
          </Part>
        </div>

        {p.canViewJourney && (
          <Part title="Time in each stage" className="border-t border-border/60">
            <StageTimeChart p={p} visits={visits} onOpen={() => open("journey")} />
          </Part>
        )}

        <div className="grid divide-border/60 border-t border-border/60 md:grid-cols-12 md:divide-x">
          <Part className="md:col-span-7">
            <KeyFacts p={p} />
          </Part>
          <Part className="md:col-span-5">
            <TeamAndQuote p={p} />
          </Part>
        </div>

        {dg.latestNote && (
          <div className="border-t border-border/60 bg-mauve-2/60 px-7 py-4 [&>section]:border-0 [&>section]:bg-transparent [&>section]:p-0">
            <LatestNote dg={dg} openNotes={openNotes} />
          </div>
        )}
      </article>
    </div>
  );
}

export default function SummaryReportLayout({ p }) {
  return <NestedShell p={p} nav="pills" renderSummary={(s) => <Summary p={p} {...s} />} />;
}
