import { useState } from "react";
import { Scale } from "lucide-react";

import { Button } from "../ui/button";
import CanvassPanel from "../CanvassPanel";
import { canvassService } from "../../services/canvassService";
import { refusalMessage } from "./gridFormat";

/** "from Canvass" beside a field a winning Offer filled; it goes the moment someone edits the field (#278). */
export function FromCanvass({ what, number, className = "" }) {
  return (
    <span
      className={`ml-1.5 text-xs font-normal text-muted-foreground ${className}`}
      data-testid="from-canvass"
      title={number ? `${what} was filled from Canvass ${number}` : `${what} was filled from a Canvass`}
    >
      from Canvass
    </span>
  );
}

/**
 * "Canvass says Toyota" with an Accept, under Brand (#278). Brand is Sales' column, so only a
 * Deal Team member (the Sales band) gets the Accept button; everyone else just reads the line.
 */
export function BrandProposal({ component, canAccept, onAccepted }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const proposal = component.brandProposal;
  if (!proposal || !canAccept) return null;

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      await canvassService.acceptBrand(component.id);
      await onAccepted?.();
    } catch (e) {
      setError(refusalMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground" data-testid="brand-proposal">
      <span>Canvass says {proposal}</span>
      <Button type="button" variant="outline" size="sm" className="h-6 px-2 text-xs" disabled={busy} aria-label={`Accept brand ${proposal} for Component ${component.number}`} onClick={accept}>
        Accept
      </Button>
      {error && <span role="alert" className="text-destructive">{error}</span>}
    </div>
  );
}

/** The brochure citations on a Component's documents: links to the Offer's own file (#278). */
function Citations({ documents }) {
  const cited = (Array.isArray(documents) ? documents : []).filter((d) => d?.offer_id && d?.url);
  if (cited.length === 0) return null;
  return (
    <ul className="flex flex-wrap items-center gap-x-2" aria-label="Brochures cited from the Canvass">
      {cited.map((doc) => (
        <li key={`${doc.offer_id}-${doc.url}`}>
          <a className="underline underline-offset-2" href={doc.url} target="_blank" rel="noreferrer">
            {doc.name || "Brochure"}
          </a>
        </li>
      ))}
    </ul>
  );
}

/**
 * The Canvass of a Component (#276), opened from its row. Where a Canvass exists, a chip shows its
 * number and how many Offers it holds; every reader of the matrix may open it (what they see inside
 * is what their tier allows). Where none exists, only Purchasing gets the "Canvass" action that
 * starts one. The chip also says whether the purchasing approver has signed it off (#279); any change unsigns it.
 */
export default function ComponentCanvass({ component, canvass, canWrite, opportunityId, actorId }) {
  const [open, setOpen] = useState(false);
  if (!canvass && !canWrite) return null;

  const label = `Component ${component.number || ""}`.trim();
  const offers = canvass?.offerCount ?? 0;

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground" data-testid="component-canvass">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 gap-1 px-2 text-xs"
        aria-label={canvass ? `Open Canvass ${canvass.number} for ${label}` : `Canvass ${label}`}
        onClick={() => setOpen(true)}
      >
        <Scale size={12} aria-hidden="true" />
        {canvass ? canvass.number : "Canvass"}
      </Button>
      <Citations documents={component.documents} />
      {canvass && (
        <span>
          {offers} offer{offers === 1 ? "" : "s"}
        </span>
      )}
      {canvass && (
        <span
          data-testid="canvass-signed-state"
          className={canvass.signed_off_at ? "font-semibold text-green-11" : "text-muted-foreground"}
        >
          {canvass.signed_off_at ? "Signed off" : "Not signed"}
        </span>
      )}
      {open && (
        <CanvassPanel
          open={open}
          onOpenChange={setOpen}
          subject={{ componentId: component.id }}
          subjectLabel={`${component.number ? `${component.number} ` : ""}${component.name || "Component"}`}
          userId={actorId}
          canEdit={canWrite}
          opportunityId={opportunityId}
        />
      )}
    </div>
  );
}
