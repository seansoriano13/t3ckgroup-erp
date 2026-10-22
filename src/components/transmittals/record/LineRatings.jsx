import { useState } from "react";
import toast from "react-hot-toast";
import { Check } from "lucide-react";

import DetailGrid from "@/components/record/DetailGrid";
import LinerList from "@/components/record/LinerList";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/SelectField";
import { cn } from "@/lib/utils";
import { TRANSMITTAL_STAGE as STAGE } from "@/constants/transmittals";
import { transmittalService } from "@/services/transmittalService";
import { ipasErrorMessage } from "@/utils/ipas";

const caption = "text-label font-bold uppercase tracking-wider text-muted-foreground";

const SIDES = {
  wh: {
    label: "Warehouse",
    stage: STAGE.WAREHOUSE_CHECKING,
    rating: (l) => l.whRating,
    remark: (l) => l.whRemark,
    who: (l) => l.whInChargeName,
  },
  tech: {
    label: "TCA Technical",
    stage: STAGE.TECHNICAL_INSPECTION,
    rating: (l) => l.techRating,
    remark: (l) => l.techRemark,
    who: (l) => l.techInChargeName,
  },
};

const RATING_LOOK = {
  gc: { word: "GC", on: "border-green-8 bg-green-3 text-green-11", dot: "bg-green-9" },
  na: { word: "NA", on: "border-amber-8 bg-amber-3 text-amber-11", dot: "bg-amber-9" },
};

/** One line's rating for one side: tap GC or NA; it saves as you go (NA waits for its reason). */
function RatingCell({ ctx, line, side, inChargeId }) {
  const cfg = SIDES[side];
  const canRate = Boolean(ctx.rights.canRate[cfg.stage]);
  const saved = cfg.rating(line) ?? "";
  const [pick, setPick] = useState(saved);
  const [remark, setRemark] = useState(cfg.remark(line) ?? "");
  const [qty, setQty] = useState(line.quantityReceived == null ? "" : String(line.quantityReceived));
  const [state, setState] = useState("idle");
  const showQty = canRate && !(side === "tech" && ctx.t.checkWarehouse);

  const save = async (next) => {
    setState("saving");
    try {
      await transmittalService.rateLines(ctx.t.id, [
        { lineId: line.id, rating: next.rating, remark: next.remark, inChargeId: inChargeId || null, quantityReceived: next.qty },
      ]);
      setState("saved");
      ctx.refresh();
    } catch (error) {
      setState("idle");
      toast.error(ipasErrorMessage(error, "The rating could not be saved."));
    }
  };

  if (!canRate) {
    const look = RATING_LOOK[saved];
    const received = line.quantityReceived != null && Number(line.quantityReceived) !== Number(line.quantity);
    return (
      <div className="min-w-[9rem] space-y-0.5">
        <p className={caption}>{cfg.label}</p>
        <p className="flex items-center gap-1.5 text-[13px]">
          {look ? (
            <>
              <span aria-hidden="true" className={cn("size-2 rounded-full", look.dot)} />
              <span className="font-bold text-foreground">{look.word}</span>
              {cfg.who(line) && <span className="text-muted-foreground">· {cfg.who(line)}</span>}
            </>
          ) : (
            <span className="text-muted-foreground">Not rated</span>
          )}
        </p>
        {cfg.remark(line) && <p className="max-w-[16rem] text-[12px] text-muted-foreground">{cfg.remark(line)}</p>}
        {received && <p className="text-[12px] font-semibold text-amber-11">{line.quantityReceived} of {line.quantity} received</p>}
      </div>
    );
  }

  return (
    <div className="min-w-[13rem] space-y-1.5">
      <p className={caption}>{cfg.label}</p>
      <div className="flex items-center gap-1.5">
        {["gc", "na"].map((value) => (
          <Button
            key={value}
            type="button"
            size="sm"
            variant="outline"
            aria-pressed={pick === value}
            disabled={ctx.busy}
            onClick={() => {
              setPick(value);
              if (value === "gc") save({ rating: "gc", remark: "", qty });
            }}
            className={cn("h-8 w-12 font-bold", pick === value ? RATING_LOOK[value].on : "text-muted-foreground")}
          >
            {RATING_LOOK[value].word}
          </Button>
        ))}
        {showQty && (
          <Input
            type="number"
            min="0"
            step="any"
            className="h-8 w-24 text-[13px]"
            value={qty}
            placeholder={`= ${line.quantity}`}
            aria-label={`Quantity received, line ${line.position}`}
            onChange={(e) => setQty(e.target.value)}
            onBlur={() => pick && (pick === "gc" || remark.trim()) && qty !== (line.quantityReceived == null ? "" : String(line.quantityReceived)) && save({ rating: pick, remark: pick === "na" ? remark : "", qty })}
          />
        )}
        <span className="w-4 text-[11px] text-muted-foreground" aria-live="polite">
          {state === "saving" ? "…" : state === "saved" ? <Check size={13} /> : null}
        </span>
      </div>
      {pick === "na" && (
        <Input
          className="h-8 text-[13px]"
          value={remark}
          placeholder="Why is it NA? Enter to save"
          aria-label={`Remark, line ${line.position}`}
          onChange={(e) => setRemark(e.target.value)}
          onBlur={() => remark.trim() && saved !== "na" && save({ rating: "na", remark, qty })}
          onKeyDown={(e) => e.key === "Enter" && remark.trim() && save({ rating: "na", remark, qty })}
        />
      )}
    </div>
  );
}

/**
 * The slip's lines with their ratings beside them. Where the viewer may rate,
 * the cells are live: one "Rating as" pick for the whole check (instead of one
 * per line) and "Mark all GC" for the common case.
 */
export default function LineRatings({ ctx }) {
  const { t, rights, members, user } = ctx;
  const sides = [t.checkWarehouse && "wh", t.checkTechnical && "tech"].filter(Boolean);
  const liveSide = rights.canRate[STAGE.WAREHOUSE_CHECKING] ? "wh" : rights.canRate[STAGE.TECHNICAL_INSPECTION] ? "tech" : null;
  const list = liveSide === "tech" ? members.technical : members.warehouse;
  const [chosen, setChosen] = useState("");
  const inChargeId = chosen || (list.some((m) => m.id === user?.id) ? user.id : "");
  const unrated = liveSide ? t.lines.filter((l) => !SIDES[liveSide].rating(l)) : [];
  const [busy, setBusy] = useState(false);

  const markAll = async () => {
    setBusy(true);
    try {
      await transmittalService.rateLines(
        t.id,
        unrated.map((l) => ({ lineId: l.id, rating: "gc", remark: "", inChargeId: inChargeId || null, quantityReceived: null })),
      );
      toast.success(`${unrated.length} line${unrated.length === 1 ? "" : "s"} marked GC.`);
      ctx.refresh();
    } catch (error) {
      toast.error(ipasErrorMessage(error, "The ratings could not be saved."));
    } finally {
      setBusy(false);
    }
  };

  if (t.lines.length === 0) return <p className="text-[13px] text-muted-foreground">No lines.</p>;
  return (
    <div className="space-y-3">
      {liveSide && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-muted/50 px-4 py-2.5">
          <div className="flex items-center gap-2 text-[13px]">
            <span className="font-semibold text-foreground">Rating as</span>
            <SelectField
              size="sm"
              className="w-52"
              options={list.map((m) => ({ value: m.id, label: m.name }))}
              value={inChargeId}
              onChange={setChosen}
              placeholder="Pick who is in charge"
            />
          </div>
          <Button type="button" size="sm" variant="outline" disabled={busy || unrated.length === 0} onClick={markAll} className="gap-1.5">
            <Check size={14} /> {unrated.length === 0 ? "All rated" : `Mark ${unrated.length} unrated as GC`}
          </Button>
        </div>
      )}
      <LinerList
        label="Lines"
        rows={t.lines.map((line) => {
          const ratings = sides.map((side) => SIDES[side].rating(line)).filter(Boolean);
          const badge = ratings.includes("na")
            ? { label: "NA", theme: "amber" }
            : ratings.length > 0 && ratings.length === sides.length
              ? { label: "GC", theme: "green" }
              : null;
          return {
            key: line.id,
            main: line.description,
            sub: [line.poNumber ?? "Typed", line.sor?.salesReference].filter(Boolean).join(" · "),
            quantity: `${line.quantity} ${line.unit ?? ""}`.trim(),
            badge,
            children: (
              <div className="space-y-4">
                <DetailGrid
                  hideEmpty
                  items={[
                    { label: "Line", value: line.position, mono: true },
                    { label: "PO", value: line.poNumber ?? "Typed", mono: true },
                    { label: "SOR", value: line.sor?.salesReference, mono: true },
                    { label: "Serial numbers", value: line.serialNumbers },
                    { label: "Boxes", value: line.boxQuantity },
                  ]}
                />
                {sides.length > 0 && (
                  <div className="flex flex-wrap gap-x-8 gap-y-3">
                    {sides.map((side) => (
                      <RatingCell
                        key={`${side}:${line.id}:${SIDES[side].rating(line)}:${SIDES[side].remark(line)}`}
                        ctx={ctx}
                        line={line}
                        side={side}
                        inChargeId={inChargeId}
                      />
                    ))}
                  </div>
                )}
              </div>
            ),
          };
        })}
      />
    </div>
  );
}
