import { useState } from "react";
import { Link } from "react-router";
import { Scale } from "lucide-react";

import { Button, buttonVariants } from "../ui/button";
import { ExternalLink } from "../ui/external-link";
import { canvassService } from "../../services/canvassService";
import { refusalMessage } from "./gridFormat";
import { canvassHref } from "../../utils/canvassList";

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
 * The Canvass button on an S0 Evaluation line (#972, spec #956). A Canvass belongs to the Purchase
 * Request, so the button opens the Canvass of the request that carries this line, at the line
 * (`canvassHref`, the request's grid from #970). With no request yet it is off and says to raise
 * the request first, with a link to the SOR where its Purchase Request step is, for a viewer who may
 * use it (`canRaise`). A line on more than one request (#798) lists each request's Canvass.
 * `items` are the line's Requested Items (`{ id, request_id, request_label }`).
 */
function CanvassButton({ component, items = [], canRaise, opportunityId }) {
  const name = `Canvass ${component.number || ""}`.trim();
  const onRequests = [...new Map(items.filter((i) => i.request_id && i.status !== "cancelled").map((i) => [i.request_id, i])).values()];

  if (onRequests.length === 0) {
    return (
      <>
        <Button type="button" variant="outline" size="sm" className="h-6 px-2 text-xs" disabled aria-label={name}>
          <Scale aria-hidden="true" />
          Canvass
        </Button>
        <span>Raise the Purchase Request first</span>
        {canRaise && opportunityId && (
          <Link className="underline underline-offset-2" to="/sors" state={{ openOpportunityId: opportunityId }}>
            Raise it from the SOR
          </Link>
        )}
      </>
    );
  }

  if (onRequests.length === 1) {
    const [item] = onRequests;
    return (
      <Link
        className={buttonVariants({ variant: "outline", size: "sm", className: "h-6 px-2 text-xs" })}
        to={canvassHref({ requestId: item.request_id, itemId: item.id })}
        aria-label={name}
      >
        <Scale aria-hidden="true" />
        Canvass
      </Link>
    );
  }

  return (
    <>
      <span className="inline-flex items-center gap-1">
        <Scale size={12} aria-hidden="true" />
        Canvass on
      </span>
      <ul className="flex flex-wrap items-center gap-x-2" aria-label={`Canvasses of ${component.number || component.name}`}>
        {onRequests.map((item) => (
          <li key={item.request_id}>
            <Link className="underline underline-offset-2" to={canvassHref({ requestId: item.request_id, itemId: item.id })}>
              {item.request_label || "Purchase Request"}
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * What a Component's row says about its Canvass (#967, #972): the Canvass button, and where one of
 * its Requested Items has been quoted, the Canvass number, the brochures cited from it and how many
 * suppliers quoted it.
 */
export default function ComponentCanvass({ component, canvass, items, canRaise = false, opportunityId }) {
  const suppliers = canvass?.offerCount ?? 0;

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground" data-testid="component-canvass">
      <CanvassButton component={component} items={items} canRaise={canRaise} opportunityId={opportunityId} />
      {canvass && (
        <>
          <span className="font-medium text-foreground" aria-label={`Canvass ${canvass.number} for Component ${component.number || ""}`.trim()}>
            {canvass.number}
          </span>
          <Citations documents={component.documents} />
          <span>
            {suppliers} supplier{suppliers === 1 ? "" : "s"}
          </span>
        </>
      )}
    </div>
  );
}
