import { useState } from "react";

import { Button } from "../ui/button";
import { ExternalLink } from "../ui/external-link";
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
 * "Canvass says Toyota" with an Accept, under Brand (#278). Brand is written by Sales and
 * Purchasing, so either band gets the Accept button; everyone else just reads the line.
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
          <ExternalLink className="underline underline-offset-2" href={doc.url}>
            {doc.name || "Brochure"}
          </ExternalLink>
        </li>
      ))}
    </ul>
  );
}

/**
 * What a Component's row says about its Canvass (#967, spec #956): where one of its Requested Items
 * has been quoted, the Canvass number and how many suppliers quoted it. A Canvass belongs to the
 * Purchase Request now, so the row no longer opens or starts one; the request's Canvass grid, opened
 * at the line, arrives with #970 and the S0 Evaluation's Canvass button with #972.
 */
export default function ComponentCanvass({ component, canvass }) {
  if (!canvass) return null;
  const suppliers = canvass.offerCount ?? 0;

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground" data-testid="component-canvass">
      <span className="font-medium text-foreground" aria-label={`Canvass ${canvass.number} for Component ${component.number || ""}`.trim()}>
        {canvass.number}
      </span>
      <Citations documents={component.documents} />
      <span>
        {suppliers} supplier{suppliers === 1 ? "" : "s"}
      </span>
    </div>
  );
}
