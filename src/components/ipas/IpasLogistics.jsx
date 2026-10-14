import { DetailRow } from "../ui/DetailParts";
import { SelectField } from "../ui/SelectField";
import { IpasSection } from "./IpasSections";
import { IPAS_OPTION_LIST, ipasSectionLabel } from "../../constants/ipas";
import { optionsForPicker } from "../../utils/ipasPayments";
import { useEditable } from "./record/sectionChrome";

const NONE = "__none__";

/**
 * Section 5, Logistics (#246): the typed Item Location, picked from the list the
 * business edits. TG03 Location is gone.
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
            ipas.itemLocation?.label
          )}
        </DetailRow>
      </dl>
    </IpasSection>
  );
}
