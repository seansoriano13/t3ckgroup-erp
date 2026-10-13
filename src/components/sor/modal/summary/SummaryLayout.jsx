/**
 * The SOR modal layout: summary, two columns. The same picks as
 * "Summary · stacked", arranged to fit one screen: the numbers across the top, what to do and
 * where the money is (and the Purchase Request, when there is one) on the left,
 * time per stage, team and facts on the right.
 * The crumb also lists the sibling views, so any section is one click from
 * any other.
 */
import NestedShell from "./NestedShell";
import PurchaseRequestCard from "../PurchaseRequestCard";
import IpasSorSection from "../../../ipas/IpasSorSection";
import { AttentionList, KeyFacts, LatestNote, SectionTitle, StatsBand, StatusLine, TeamAndQuote } from "./DigestSummary";
import { MoneyBars, StageTimeChart } from "./SummaryCharts";
import { useJourneyVisits } from "./StageStrip";
import { useDigest } from "./useDigest";
import { showMoney } from "./shared";

function Summary({ p, go, open, openNotes }) {
  const dg = useDigest(p);
  const visits = useJourneyVisits(p);
  return (
    <div className="space-y-6 p-6">
      <StatusLine p={p} dg={dg} />
      <StatsBand p={p} dg={dg} />

      <div className="grid gap-6 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-7">
          <AttentionList dg={dg} go={go} />
          <section>
            <SectionTitle aside={showMoney(p) && dg.itemsCount > 0 && <span className="text-xs font-semibold tabular-nums text-muted-foreground">{dg.itemsTotal}</span>}>
              {showMoney(p) ? "Where the money is" : "What's being quoted"}
            </SectionTitle>
            <div className="rounded-xl border border-border/70 bg-card p-5">
              <MoneyBars p={p} onOpen={() => open("items")} />
            </div>
          </section>
          {/* #310: renders nothing for an SOR with no Purchase Request. */}
          <PurchaseRequestCard opportunityId={p.id} />
          {/* #249: renders nothing when no IPAS names this SOR (or the viewer cannot read it). */}
          <IpasSorSection opportunityId={p.id} />
        </div>

        <div className="space-y-6 lg:col-span-5">
          {p.canViewJourney && (
            <section>
              <SectionTitle>Time in each stage</SectionTitle>
              <div className="rounded-xl border border-border/70 bg-card p-5">
                <StageTimeChart p={p} visits={visits} onOpen={() => open("journey")} />
              </div>
            </section>
          )}
          <div className="rounded-xl border border-border/70 bg-card p-5">
            <TeamAndQuote p={p} />
          </div>
          <div className="rounded-xl border border-border/70 bg-card p-5">
            <KeyFacts p={p} />
          </div>
          <LatestNote dg={dg} openNotes={openNotes} />
        </div>
      </div>
    </div>
  );
}

export default function SummaryTwoColumnLayout({ p }) {
  return <NestedShell p={p} nav="pills" renderSummary={(s) => <Summary p={p} {...s} />} />;
}
