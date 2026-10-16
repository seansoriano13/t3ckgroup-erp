import { Link } from "react-router";
import { DetailRow } from "../ui/DetailParts";
import { SelectField } from "../ui/SelectField";
import { IpasSection } from "./IpasSections";
import { IPAS_OPTION_LIST, ipasSectionLabel } from "../../constants/ipas";
import { formatDay, optionsForPicker } from "../../utils/ipasPayments";
import { useEditable } from "@/components/record/sectionChrome";

const NONE = "__none__";

/**
 * Section 5, Logistics (#246, #256): the typed Item Location, picked from the
 * list the business edits (the Transmittals' Item Location shows until one is
 * typed), and the TG03 Transmittals carrying this IPAS's lines, with links.
 *
 *   canChange   Purchasing on an open IPAS
 */
export function IpasLogisticsSection({ ipas, canChange: granted = false, onPick }) {
  const canChange = useEditable(granted);
  const options = [
    { value: NONE, label: "Not set" },
    ...optionsForPicker(ipas.options ?? [], IPAS_OPTION_LIST.ITEM_LOCATION, ipas.item_location_id).map((option) => ({
      value: option.id,
      label: option.active ? option.label : `${option.label} (deactivated)`,
    })),
  ];
  const transmittals = ipas.slips ?? [];

  return (
    <IpasSection title={ipasSectionLabel("logistics")}>
      <dl className="grid grid-cols-1 gap-x-8 divide-y divide-border sm:grid-cols-2 sm:divide-y-0">
        <DetailRow label="Item Location">
          {canChange ? (
            <SelectField
              size="sm"
              options={options}
              value={ipas.item_location_id ?? NONE}
              onChange={(value) => onPick(value === NONE ? null : value)}
              aria-label="Item Location"
            />
          ) : (
            <>
              {ipas.itemLocation?.label}
              {ipas.itemLocation && ipas.itemLocationSource === "transmittals" && (
                <span className="ml-2 text-xs text-muted-foreground">from the TG03 Transmittals</span>
              )}
            </>
          )}
        </DetailRow>
      </dl>
      <div className="mt-3" data-testid="ipas-transmittals">
        <p className="text-xs font-medium text-muted-foreground">Transmittals (TG03)</p>
        {transmittals.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">No Transmittal carries this IPAS yet.</p>
        ) : (
          <ul className="mt-1 divide-y divide-border">
            {transmittals.map((slip) => (
              <li key={slip.id} className="flex flex-wrap items-center gap-x-3 py-2 text-sm">
                <Link to={`/purchasing/transmittals/${slip.id}`} className="font-medium text-foreground underline-offset-2 hover:underline">
                  {slip.number}
                </Link>
                {slip.date && <span className="text-xs text-muted-foreground">{formatDay(slip.date)}</span>}
                {slip.priority && <span className="text-xs capitalize text-muted-foreground">{slip.priority}</span>}
                <span className="text-xs text-muted-foreground">{slip.stateLabel}</span>
                {slip.naCount > 0 && (
                  <span className="text-xs font-medium text-amber-11">
                    {slip.naCount} NA {slip.naCount === 1 ? "line" : "lines"}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </IpasSection>
  );
}
