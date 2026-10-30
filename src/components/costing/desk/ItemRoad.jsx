import { Link } from "react-router";

import { cn } from "@/lib/utils";
import { IPAS_STATE_LABELS } from "../../../constants/ipas";
import { ROAD_LABELS, ROAD_STEPS, componentRoad } from "../../../utils/itemRoad";

/**
 * A part's road from plan to warehouse (utils/itemRoad), as one row of steps with the one it is on
 * lit, and under it the IPAS that pays for it. The IPAS links only when `linkIpas`; the IPAS page still
 * decides who may read it. No money, so every tier sees it.
 */
export default function ItemRoad({ component, locked, linkIpas }) {
  const road = componentRoad(component, { locked });
  return (
    <div className="space-y-1.5 rounded-lg border border-border bg-muted/30 px-3 py-2" data-testid="item-road" data-step={road.step}>
      <ol className="flex flex-wrap items-center gap-x-1 gap-y-1 text-[11px]">
        {ROAD_STEPS.map((step, i) => {
          const done = i < road.index;
          const here = i === road.index;
          return (
            <li key={step} className="flex items-center gap-1">
              {i > 0 && <span aria-hidden="true" className={cn("h-px w-3", done || here ? "bg-foreground/50" : "bg-border")} />}
              <span
                aria-current={here ? "step" : undefined}
                className={cn(
                  "rounded-full px-2 py-0.5",
                  here ? "bg-foreground font-semibold text-background" : done ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {here && road.fromStock ? "From stock" : ROAD_LABELS[step]}
              </span>
            </li>
          );
        })}
      </ol>
      {road.stuck && <p className="text-xs text-red-11">Purchasing marked this part as cannot source.</p>}
      {road.ipas.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Paid through{" "}
          {road.ipas.map((i, n) => {
            const text = `${i.number} (${i.poNumber}, ${IPAS_STATE_LABELS[i.state] || i.state})`;
            return (
              <span key={i.poNumber}>
                {n > 0 && ", "}
                {linkIpas ? (
                  <Link to={`/purchasing/ipas/${i.ipasId}`} className="underline underline-offset-2 hover:text-foreground">
                    {text}
                  </Link>
                ) : (
                  text
                )}
              </span>
            );
          })}
        </p>
      )}
    </div>
  );
}
