import { Link } from "react-router";

import { IPAS_STATE_LABELS } from "../../../constants/ipas";
import StatusBadge from "../../StatusBadge";
import { buyingStatus } from "../../../utils/buyingStatus";

/**
 * A part's buying status in the Purchase Request's own words (utils/buyingStatus), and under it the IPAS
 * that pays for it. Nothing shows before anything is requested. The IPAS links only when `linkIpas`; the
 * IPAS page still decides who may read it. No money, so every tier sees it.
 */
export default function ItemRoad({ component, linkIpas }) {
  const status = buyingStatus(component?.purchases?.requests);
  const ipas = (component?.purchases?.ipas ?? []).filter((i) => i.ipasId);
  if (!status && ipas.length === 0) return null;
  return (
    <div className="mb-2 space-y-1.5" data-testid="item-road">
      {status && <StatusBadge label={status.label} theme={status.theme} />}
      {ipas.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Paid through{" "}
          {ipas.map((i, n) => {
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
