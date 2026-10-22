import { Link } from "react-router";
import MoveButton from "@/components/record/MoveButton";
import { StateWord } from "@/components/record/StateMark";
import { CHROME } from "@/components/record/sectionChrome";
import StepMark from "@/components/record/StepMark";
import { useMoveConfirm } from "@/components/record/useMoveConfirm";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import SectionTitle from "../SectionTitle";
import LineRatings from "./LineRatings";
import SlipFacts from "./SlipFacts";
import { footerMovesFor, slipMovesFor } from "./transmittalMoves";
import { railStepsOf } from "./transmittalRecord";

const caption = "text-label font-bold uppercase tracking-wider text-muted-foreground";

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
 * A Transmittal record as a desk and a rail. The slip fills the left: its facts,
 * then its lines, rated in place. The right rail is the "Your move" card and the
 * step list in one: picking a step opens its work under the list, with its sign
 * button. Nothing slides over the record.
 *
 * `ctx` is what the record page already worked out (the slip, rights, gates,
 * moves, forms); `picked` / `onPick` is the step open in the rail (null: the one
 * that needs doing, else the first).
 */
export default function TransmittalDesk({ ctx, picked, onPick }) {
  const { t, built, gates, summaries, status, nextSlip, busy, failure } = ctx;
  const { run, dialog } = useMoveConfirm({ restate: ctx.restate, viewer: ctx.user?.name, origin: CHROME.CARD });
  const steps = railStepsOf(t, gates, summaries).map((step) => ({
    ...step,
    moves: footerMovesFor(built, step.key),
  }));
  const slipMoves = slipMovesFor(built);
  const first =
    steps.find((s) => s.moves.some((m) => m.kind !== "return")) ?? steps.find((s) => gates.find((g) => g.key === s.key)?.now) ?? steps[0];
  const selected = steps.find((s) => s.key === (picked ?? first?.key)) ?? null;

  return (
    <div className="grid gap-8 pb-2 xl:grid-cols-[minmax(0,1fr)_25rem]">
      <div className="min-w-0 space-y-8">
        <SlipFacts t={t} />
        <section>
          <SectionTitle title={`Lines · ${t.lines.length}`} />
          <LineRatings ctx={ctx} />
        </section>
      </div>

      <aside className="min-w-0 xl:sticky xl:top-2 xl:self-start">
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <div className="space-y-3 p-4">
            <h2 className={caption}>Your move</h2>
            <p className="text-[15px] font-bold leading-snug text-foreground">{status}</p>
            {nextSlip && (
              <p className="text-[13px]">
                <Link to={`/purchasing/transmittals/${nextSlip.id}`} className="font-semibold underline underline-offset-4">
                  Next waiting for me: {nextSlip.number}
                </Link>
              </p>
            )}
            <MoveList items={slipMoves} run={run} busy={busy} failure={failure} />
          </div>

          {steps.length > 0 && (
            <ol className="border-t border-border p-1.5">
              {steps.map((s) => {
                const on = selected?.key === s.key;
                return (
                  <li key={s.key}>
                    <Button
                      type="button"
                      variant="ghost"
                      aria-current={on ? "step" : undefined}
                      onClick={() => onPick(s.key)}
                      className={cn("h-auto w-full justify-start gap-3 rounded-xl px-3 py-2 text-left whitespace-normal", on && "bg-muted")}
                    >
                      <StepMark state={s.state?.state} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-bold text-foreground">{s.title}</span>
                        <span className="block truncate text-[12px] font-normal text-muted-foreground">{s.summary}</span>
                      </span>
                      {s.state && <StateWord state={s.state.state} className="shrink-0 text-xs" />}
                    </Button>
                  </li>
                );
              })}
            </ol>
          )}

          {selected && (
            <div key={selected.key} className="animate-in space-y-4 border-t border-border p-4 duration-300 fade-in-0">
              <div>
                <h3 className="text-[15px] font-black tracking-tight text-foreground">{selected.title}</h3>
                <p className="text-[13px] text-muted-foreground">{selected.summary}</p>
              </div>
              {ctx.bodyOf(selected.key)}
              <MoveList items={selected.moves} run={run} busy={busy} failure={failure} />
            </div>
          )}
        </div>
      </aside>
      {dialog}
    </div>
  );
}
