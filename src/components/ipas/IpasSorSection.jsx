import { Check, Circle, CircleDot, ReceiptText } from "lucide-react";

import { Button } from "../ui/button";
import SectionHeader from "../ui/SectionHeader";
import StatusBadge from "../StatusBadge";
import { useAuth } from "../../context/AuthContext";
import { getPermissionContext, canReadIpas } from "../../utils/permissions";
import { IPAS_PURPOSE_LABELS } from "../../constants/ipas";
import IpasStateBadge from "./IpasStateBadge";
import { useIpasSorSummaries } from "./useIpasSorSummaries";

/** Opens the full IPAS in its own tab, so the SOR stays where it is. */
const openIpas = (id) => window.open(`/purchasing/ipas/${id}`, "_blank", "noopener");

function TrackChip({ item }) {
  const Icon = item.ticked ? Check : item.partial ? CircleDot : Circle;
  const theme = item.ticked ? "green" : item.partial ? "amber" : "mauve";
  return (
    <li>
      <StatusBadge
        theme={theme}
        className="gap-1"
        title={item.ticked ? `${item.label}: done` : item.partial ? `${item.label}: partly done` : `${item.label}: not yet`}
      >
        <Icon size={11} aria-hidden="true" />
        {item.label}
      </StatusBadge>
    </li>
  );
}

function SummaryRow({ summary, canOpen }) {
  return (
    <div className="space-y-2.5 rounded-xl border border-border/70 bg-card/50 px-4 py-3" data-testid="ipas-summary">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold text-foreground">
            <span>{summary.number}</span>
            <IpasStateBadge state={summary.state} />
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {[summary.poNumber, summary.supplier, IPAS_PURPOSE_LABELS[summary.purpose]].filter(Boolean).join(" · ")}
          </p>
        </div>
        {canOpen && (
          <Button type="button" variant="outline" size="sm" onClick={() => openIpas(summary.id)}>
            Open IPAS
          </Button>
        )}
      </div>

      <div>
        <p className="mb-1 text-xs font-semibold text-muted-foreground">
          Buyer track · {summary.trackDone} of {summary.trackTotal}
        </p>
        <ul className="flex flex-wrap gap-1.5" aria-label="Buyer track">
          {summary.buyerTrack.map((item) => (
            <TrackChip key={item.key} item={item} />
          ))}
        </ul>
      </div>

      <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
        <div className="flex items-baseline gap-2">
          <dt className="text-muted-foreground">Costing</dt>
          <dd className="font-medium text-foreground">{summary.computationLabel}</dd>
        </div>
        {summary.signoffs.map((section) => (
          <div key={section.section} className="flex items-baseline gap-2">
            <dt className="text-muted-foreground">
              Section {section.section} · {section.name}
            </dt>
            <dd className="font-medium text-foreground">
              {section.steps
                .filter((step) => step.done)
                .map((step) => step.label)
                .join(", ") || "Not started"}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * The IPAS section of an SOR (#249): each Project IPAS naming it, as a summary
 * (number, PO, supplier, state, the buyer track, costing and sign-off
 * progress). Never payments, charges, bank details or Landed Cost: the database
 * returns none of those to this reader.
 *
 * Renders nothing when no IPAS names the SOR or the viewer may not read the
 * SOR. A row opens the full IPAS only for someone who can read every IPAS;
 * everyone else only reads the summary.
 *
 * Self-contained: the PMS page takes `ipas_summaries_for_sor` over in build
 * step 5 and can render this section as it is.
 */
export default function IpasSorSection({ opportunityId }) {
  const { user } = useAuth();
  const { data: summaries } = useIpasSorSummaries(opportunityId);
  if (!summaries || summaries.length === 0) return null;
  const canOpen = canReadIpas(getPermissionContext(user));

  return (
    <section className="space-y-3" aria-label="IPAS">
      <SectionHeader
        title={
          <>
            <ReceiptText size={16} aria-hidden="true" />
            IPAS
          </>
        }
        className="pb-2"
      />
      <div className="space-y-2">
        {summaries.map((summary) => (
          <SummaryRow key={summary.id} summary={summary} canOpen={canOpen} />
        ))}
      </div>
    </section>
  );
}
