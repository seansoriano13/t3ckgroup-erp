/**
 * REMOVE-BEFORE-PROD — layout "Summary · stacked". Round 3's picks in one
 * column you read top to bottom: the digest summary, then "where the money is"
 * and "time in each stage". Sections open behind a path-only crumb
 * ("Summary › Products"), reached from the link row under the numbers.
 */
import NestedShell, { SectionLinks } from "../summary/NestedShell";
import { AttentionList, KeyFacts, LatestNote, SectionTitle, StatsBand, StatusLine, TeamAndQuote } from "../summary/DigestSummary";
import { MoneyBars, StageTimeChart } from "../summary/SummaryCharts";
import { useJourneyVisits } from "../summary/StageStrip";
import { useDigest } from "../summary/useDigest";
import { showMoney } from "../summary/shared";

function Summary({ p, go, open, views, openNotes }) {
  const dg = useDigest(p);
  const visits = useJourneyVisits(p);
  return (
    <div className="mx-auto max-w-4xl space-y-7 p-6">
      <StatusLine p={p} dg={dg} />
      <StatsBand p={p} dg={dg} />
      <SectionLinks views={views} open={open} className="-mt-3" />
      <AttentionList dg={dg} go={go} />

      <section>
        <SectionTitle aside={showMoney(p) && dg.itemsCount > 0 && <span className="text-xs font-semibold tabular-nums text-muted-foreground">{dg.itemsTotal}</span>}>
          {showMoney(p) ? "Where the money is" : "What's being quoted"}
        </SectionTitle>
        <div className="rounded-xl border border-border/70 bg-card p-5">
          <MoneyBars p={p} onOpen={() => open("items")} />
        </div>
      </section>

      {p.canViewJourney && (
        <section>
          <SectionTitle>Time in each stage</SectionTitle>
          <div className="rounded-xl border border-border/70 bg-card p-5">
            <StageTimeChart p={p} visits={visits} onOpen={() => open("journey")} />
          </div>
        </section>
      )}

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

export default function SummaryStackedLayout({ p }) {
  return <NestedShell p={p} nav="crumb" renderSummary={(s) => <Summary p={p} {...s} />} />;
}
