import { Link } from "react-router";
import MoveButton from "@/components/record/MoveButton";
import { CHROME } from "@/components/record/sectionChrome";
import RecordHeader from "@/components/record/RecordHeader";
import YourMoveCard from "@/components/record/YourMoveCard";
import { useMoveConfirm } from "@/components/record/useMoveConfirm";
import { formatPreparedAt } from "@/utils/preparedAt";
import { transmittalStateLabel } from "@/utils/transmittals";
import SectionTitle from "../SectionTitle";
import LineRatings from "./LineRatings";
import SlipFacts from "./SlipFacts";
import { footerMovesFor, slipMovesFor } from "./transmittalMoves";
import { badgeThemeOf, railStepsOf } from "./transmittalRecord";

function MoveList({ items, run, busy, failure }) {
  if (items.length === 0) return null;
  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <MoveButton key={item.key} move={item} origin="card" disabled={busy} busy={busy} failure={failure} onRun={run} />
      ))}
    </ul>
  );
}

/**
 * A Transmittal record as a desk and a rail, inside the record window. The slip
 * fills the left: the header (number · company, its state, who prepared it), its
 * fact pills, then its lines as a liner list that opens to the ratings. The
 * right rail is the shared "Your move" card; its steps open in place.
 *
 * `ctx` is what the record page already worked out (the slip, rights, gates,
 * moves, forms).
 */
export default function TransmittalDesk({ ctx }) {
  const { t, built, gates, summaries, status, nextSlip, busy, failure } = ctx;
  const { run, dialog } = useMoveConfirm({ restate: ctx.restate, viewer: ctx.user?.name, origin: CHROME.CARD });
  const steps = railStepsOf(t, gates, summaries).map((step) => {
    const moves = footerMovesFor(built, step.key);
    return {
      key: step.key,
      title: step.title,
      summary: step.summary,
      state: step.state?.state,
      needsMe: moves.some((m) => m.kind !== "return"),
      body: ctx.bodyOf(step.key),
      moves: <MoveList items={moves} run={run} busy={busy} failure={failure} />,
    };
  });

  return (
    <div className="space-y-6 pb-2">
      <RecordHeader
        reference={t.number}
        name={t.entity}
        badge={{ label: transmittalStateLabel(t.state), theme: badgeThemeOf(t.state) }}
        line={`Prepared ${formatPreparedAt(t.preparedOn)}${t.preparedBy?.name ? ` by ${t.preparedBy.name}` : ""}`}
      />
      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_25rem]">
        <div className="min-w-0 space-y-6">
          <SlipFacts t={t} />
          <section>
            <SectionTitle title={`Lines · ${t.lines.length}`} />
            <LineRatings ctx={ctx} />
          </section>
        </div>

        <aside className="min-w-0 xl:sticky xl:top-2 xl:self-start">
          <YourMoveCard
            status={status}
            next={
              nextSlip && (
                <p className="text-[13px]">
                  <Link to={`/purchasing/transmittals/${nextSlip.id}`} className="font-semibold underline underline-offset-4">
                    Next waiting for me: {nextSlip.number}
                  </Link>
                </p>
              )
            }
            lead={<MoveList items={slipMovesFor(built)} run={run} busy={busy} failure={failure} />}
            steps={steps}
          />
        </aside>
      </div>
      {dialog}
    </div>
  );
}
