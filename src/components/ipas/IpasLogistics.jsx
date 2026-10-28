import { Check } from "lucide-react";
import { Link } from "react-router";
import DetailGrid from "@/components/record/DetailGrid";
import LinerList from "@/components/record/LinerList";
import { Button } from "../ui/button";
import { SelectField } from "../ui/SelectField";
import { IpasSection } from "./IpasSections";
import { IPAS_OPTION_LIST, ipasSectionLabel } from "../../constants/ipas";
import { optionsForPicker } from "../../utils/ipasPayments";
import { formatPreparedAt } from "../../utils/preparedAt";
import { formatDate } from "../../utils/formatDate.js";
import { useEditable } from "@/components/record/sectionChrome";

const NONE = "__none__";

/**
 * Section 5, Logistics (#246, #256): the typed Item Location, picked from the
 * list the business edits (the Transmittals' Item Location shows until one is
 * typed), and the TG03 Transmittals carrying this IPAS's lines, with links.
 *
 *   canChange   Purchasing on an open IPAS
 *   signRights  { canSign }: on the Logistics signer list, IPAS open, not signed yet (#713)
 *   onSign      gives the Logistics sign-off; Filing waits for it
 */
export function IpasLogisticsSection({ ipas, canChange: granted = false, onPick, signRights, onSign, busy = false }) {
  const canChange = useEditable(granted);
  const options = [
    { value: NONE, label: "Not set" },
    ...optionsForPicker(ipas.options ?? [], IPAS_OPTION_LIST.ITEM_LOCATION, ipas.item_location_id).map((option) => ({
      value: option.id,
      label: option.active ? option.label : `${option.label} (deactivated)`,
    })),
  ];
  const transmittals = ipas.slips ?? [];
  const signed = ipas.signoffSections?.[8]?.approved ?? null;

  return (
    <IpasSection title={ipasSectionLabel("logistics")}>
      <DetailGrid
        items={[
          {
            label: "Item Location",
            value: canChange ? (
              <SelectField
                size="sm"
                options={options}
                value={ipas.item_location_id ?? NONE}
                onChange={(value) => onPick(value === NONE ? null : value)}
                aria-label="Item Location"
              />
            ) : ipas.itemLocation ? (
              <>
                {ipas.itemLocation.label}
                {ipas.itemLocationSource === "transmittals" && (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">from the TG03 Transmittals</span>
                )}
              </>
            ) : null,
          },
        ]}
      />
      <div className="mt-4 space-y-2" data-testid="ipas-transmittals">
        <p className="text-xs font-semibold text-muted-foreground">Transmittals (TG03) · {transmittals.length}</p>
        <LinerList
          label="Transmittals (TG03)"
          empty="No Transmittal carries this IPAS yet."
          rows={transmittals.map((slip) => {
            const parts = [
              slip.date ? formatPreparedAt(slip.date, { dayOnly: true }) : null,
              slip.priority ? slip.priority : null,
              slip.stateLabel,
              slip.naCount > 0 ? `${slip.naCount} NA ${slip.naCount === 1 ? "line" : "lines"}` : null,
            ].filter(Boolean);
            return {
              key: slip.id,
              main: (
                <Link to={`/purchasing/transmittals/${slip.id}`} className="font-medium text-foreground underline-offset-2 hover:underline">
                  {slip.number}
                </Link>
              ),
              sub: parts.join(" · "),
            };
          })}
        />
      </div>
      <div className="mt-4" data-testid="ipas-logistics-signoff">
        <DetailGrid
          items={[
            {
              label: "Logistics signed",
              value: signed ? (
                <>
                  <span className="flex items-center gap-1.5 font-semibold">
                    <Check size={14} className="text-green-11" aria-hidden="true" />
                    {signed.signedBy?.name ?? "Someone"}
                  </span>
                  <span className="block text-xs font-normal text-muted-foreground">{formatDate(signed.signedAt)}</span>
                </>
              ) : (
                <span className="font-normal text-muted-foreground">Signed once the goods are at their location. Filing waits for it.</span>
              ),
            },
          ]}
        />
        {signRights?.canSign && (
          <Button size="sm" className="mt-2" disabled={busy} onClick={onSign} data-testid="ipas-logistics-sign">
            Sign Logistics
          </Button>
        )}
      </div>
    </IpasSection>
  );
}
