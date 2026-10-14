import { Briefcase } from "lucide-react";
import SlideOver, { SlideOverBody } from "../ui/SlideOver";

const identity = (summary) => ({
  ref: summary.sales_reference || "SOR",
  title: summary.project_title || "This SOR",
});

/**
 * ADR 0021 / #297: a locked viewer's window on an SOR is closed — the summary
 * plus their own past visits, nothing else. No tabs, no chat, no edit, and so
 * no "View Full Details". A slide-over like Quick View, since it is a preview
 * rather than a working surface.
 *
 * `lockedSummary` may still be loading (null); the panel opens on a placeholder
 * identity meanwhile.
 */
export default function LockedSorSlideOver({ isOpen, onClose, lockedSummary, myVisits = [] }) {
  const isRestricted = !!lockedSummary?.is_restricted;

  return (
    <SlideOver
      record={isOpen ? (lockedSummary ?? {}) : null}
      icon={Briefcase}
      crumb="SORs"
      identity={identity}
      onClose={onClose}
    >
      {() => (
        <SlideOverBody>
          {isRestricted && (
            <div className="rounded-xl border border-amber-400/40 bg-amber-500/5 px-3 py-2.5 text-[13px] font-semibold text-amber-11">
              This stage is restricted.
            </div>
          )}

          <div>
            <p className="mb-1 text-label font-bold tracking-widest text-muted-foreground uppercase">Current Stage</p>
            <p className="text-sm font-semibold text-foreground">{lockedSummary?.current_stage_name || "—"}</p>
          </div>

          <div>
            <p className="mb-2 text-label font-bold tracking-widest text-muted-foreground uppercase">Your visits</p>
            {myVisits.length === 0 ? (
              <p className="text-sm text-muted-foreground/70">No visits recorded.</p>
            ) : (
              <ul className="space-y-2">
                {myVisits.map((v) => (
                  <li
                    key={v.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-sm"
                  >
                    <span className="font-medium text-foreground">{v.flow_stages?.name || "Stage"}</span>
                    <span className="text-[11px] text-muted-foreground">
                      {v.entered_at ? new Date(v.entered_at).toLocaleDateString() : ""}
                      {v.left_at ? ` – ${new Date(v.left_at).toLocaleDateString()}` : " – present"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </SlideOverBody>
      )}
    </SlideOver>
  );
}
