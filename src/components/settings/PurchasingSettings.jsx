import { useState } from "react";

import TabGroup from "../ui/TabGroup";
import IpasOptionListEditor from "../ipas/IpasOptionListEditor";
import IpasSignerListEditor from "../ipas/IpasSignerListEditor";
import TransmittalFirstNumber from "../transmittals/TransmittalFirstNumber";
import CostingMatrixSettings from "../costing/settings/CostingMatrixSettings";
import OrderAgeingRules from "./OrderAgeingRules";
import { IPAS_OPTION_LISTS, IPAS_OPTION_LIST_LABELS } from "../../constants/ipas";
import { TRANSMITTAL_OPTION_LIST } from "../../constants/transmittals";

/** The sub-tab for the sign-off lists, offered to Super Admins only. */
const SIGNERS_TAB = "signers";

/** The sub-tab for how many days each order step may take (#262). */
const AGEING_TAB = "ageing";

/** The sub-tab for the Costing Matrix's own settings: markup presets (#269) and the sections later tickets add. */
const COSTING_TAB = "costing";

/** The Transmittal option lists (#252), edited beside the IPAS ones. */
const TRANSMITTAL_LISTS = [TRANSMITTAL_OPTION_LIST.PRODUCT, TRANSMITTAL_OPTION_LIST.REFERENCE];

/**
 * The Purchasing section of Settings (issue #244, #247; spec #241): the IPAS
 * option lists the business edits (payment methods, charge kinds, freight
 * services, document kinds, item locations), each starting from the sheet's
 * values, and, for Super Admins, the sign-off lists. Purchasing access and
 * Super Admins add, rename, reorder and deactivate options; they are never
 * deleted, and a deactivated one stays on the rows that used it. The Settings
 * page only offers this tab to Purchasing access and Super Admins, and the
 * database refuses everyone else's write.
 *
 * The Costing Matrix tab (#269) holds the matrix's own settings, built from standalone sections. Final
 * Acquire list members open Settings for it even without Purchasing access; for them `costingOnly` leaves
 * that tab alone, since the IPAS lists are not theirs to edit.
 */
export default function PurchasingSettings({ isSuperAdmin = false, costingOnly = false }) {
  const [list, setList] = useState(costingOnly ? COSTING_TAB : IPAS_OPTION_LISTS[0]);
  if (costingOnly) {
    return (
      <div className="space-y-4" data-testid="purchasing-settings">
        <CostingMatrixSettings />
      </div>
    );
  }
  const tabs = [
    ...IPAS_OPTION_LISTS.map((value) => ({ value, label: IPAS_OPTION_LIST_LABELS[value] })),
    ...TRANSMITTAL_LISTS.map((value) => ({ value, label: IPAS_OPTION_LIST_LABELS[value] })),
    { value: AGEING_TAB, label: "Ageing rules" },
    { value: COSTING_TAB, label: "Costing Matrix" },
    ...(isSuperAdmin ? [{ value: SIGNERS_TAB, label: "Sign-off lists" }] : []),
  ];
  // The sign-off lists tab only exists for Super Admins; anyone else stays on an option list.
  const showSigners = list === SIGNERS_TAB && isSuperAdmin;
  const showAgeing = list === AGEING_TAB;
  const showCosting = list === COSTING_TAB;
  const optionList = list === SIGNERS_TAB || showAgeing || showCosting ? IPAS_OPTION_LISTS[0] : list;

  return (
    <div className="space-y-4" data-testid="purchasing-settings">
      <div>
        <h2 className="text-sm font-semibold text-foreground">IPAS lists</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          The lists that payments, charges, freight, documents, Item Location and Transmittals pick from. Changes
          apply to new rows; existing rows keep their option.
        </p>
      </div>
      <TabGroup variant="pill" size="sm" activeTab={showSigners ? SIGNERS_TAB : showAgeing ? AGEING_TAB : showCosting ? COSTING_TAB : optionList} onChange={setList} tabs={tabs} />
      {showCosting ? (
        <CostingMatrixSettings />
      ) : showAgeing ? (
        <OrderAgeingRules />
      ) : showSigners ? (
        <>
          {isSuperAdmin && <TransmittalFirstNumber />}
          <IpasSignerListEditor />
        </>
      ) : (
        <IpasOptionListEditor key={optionList} list={optionList} />
      )}
    </div>
  );
}
