import { useQuery } from "@tanstack/react-query";
import { PackageCheck } from "lucide-react";

import { Button } from "../ui/button";
import SectionHeader from "../ui/SectionHeader";
import StatusBadge from "../StatusBadge";
import { sorHandoffsService } from "../../services/sorHandoffsService";

/** Opens the full record in its own tab, so the SOR stays where it is. */
const openTransmittal = (id) =>
  window.open(`/purchasing/transmittals/${id}`, "_blank", "noopener");

const openPackingList = (id) =>
  window.open(`/purchasing/packing-lists/${id}`, "_blank", "noopener");

/**
 * The Transmittals and Packing Lists section of an SOR (#257): each Transmittal
 * naming it (number, priority, stage, NA count) and each Packing List (number,
 * state, box count, delivery reference). Renders nothing when there are no rows
 * or the viewer may not read the SOR. A row's Open button shows only where the
 * database says the caller can open that record.
 */
export default function HandoffsSorSection({ opportunityId }) {
  const { data } = useQuery({
    queryKey: ["sor", "handoffs", opportunityId],
    queryFn: () => sorHandoffsService.forSor(opportunityId),
    enabled: Boolean(opportunityId),
    staleTime: 0,
  });
  const transmittals = data?.transmittals ?? [];
  const packingLists = data?.packingLists ?? [];
  if (transmittals.length === 0 && packingLists.length === 0) return null;

  return (
    <section className="space-y-3" aria-label="Transmittals and Packing Lists">
      <SectionHeader
        title={
          <>
            <PackageCheck size={16} aria-hidden="true" />
            Transmittals and Packing Lists
          </>
        }
        className="pb-2"
      />
      <div className="space-y-2">
        {transmittals.map((t) => (
          <div
            key={t.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-card/50 px-4 py-3"
            data-testid="handoff-transmittal"
          >
            <div className="min-w-0 space-y-1">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold text-foreground">
                <span>{t.number}</span>
                <StatusBadge status={t.state}>{t.stateLabel}</StatusBadge>
              </p>
              <p className="text-xs text-muted-foreground">
                Priority {t.priorityLabel} · NA {t.naCount}
              </p>
            </div>
            {t.canOpen && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => openTransmittal(t.id)}
              >
                Open Transmittal
              </Button>
            )}
          </div>
        ))}
        {packingLists.map((p) => (
          <div
            key={p.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-card/50 px-4 py-3"
            data-testid="handoff-packing-list"
          >
            <div className="min-w-0 space-y-1">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold text-foreground">
                <span>{p.number}</span>
                <StatusBadge status={p.state}>{p.stateLabel}</StatusBadge>
              </p>
              <p className="text-xs text-muted-foreground">
                {[
                  `${p.boxCount} ${p.boxCount === 1 ? "box" : "boxes"}`,
                  p.odooDeliveryRef && `Delivery ${p.odooDeliveryRef}`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            {p.canOpen && (
              <Button type="button" variant="outline" size="sm" onClick={() => openPackingList(p.id)}>
                Open Packing List
              </Button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
