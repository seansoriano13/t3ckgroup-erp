import { useState } from "react";

import TabGroup from "../ui/TabGroup";
import IpasOptionListEditor from "../ipas/IpasOptionListEditor";
import IpasSignerListEditor from "../ipas/IpasSignerListEditor";
import { IPAS_OPTION_LISTS, IPAS_OPTION_LIST_LABELS } from "../../constants/ipas";

/** The sub-tab for the sign-off lists, offered to Super Admins only. */
const SIGNERS_TAB = "signers";

/**
 * The Purchasing section of Settings (issue #244, #247; spec #241): the IPAS
 * option lists the business edits (payment methods, charge kinds, freight
 * services, document kinds, item locations), each starting from the sheet's
 * values, and, for Super Admins, the sign-off lists. Purchasing access and
 * Super Admins add, rename, reorder and deactivate options; they are never
 * deleted, and a deactivated one stays on the rows that used it. The Settings
 * page only offers this tab to Purchasing access and Super Admins, and the
 * database refuses everyone else's write.
 */
export default function PurchasingSettings({ isSuperAdmin = false }) {
  const [list, setList] = useState(IPAS_OPTION_LISTS[0]);
  const tabs = [
    ...IPAS_OPTION_LISTS.map((value) => ({ value, label: IPAS_OPTION_LIST_LABELS[value] })),
    ...(isSuperAdmin ? [{ value: SIGNERS_TAB, label: "Sign-off lists" }] : []),
  ];
  // The sign-off lists tab only exists for Super Admins; anyone else stays on an option list.
  const showSigners = list === SIGNERS_TAB && isSuperAdmin;
  const optionList = list === SIGNERS_TAB ? IPAS_OPTION_LISTS[0] : list;

  return (
    <div className="space-y-4" data-testid="purchasing-settings">
      <div>
        <h2 className="text-sm font-semibold text-foreground">IPAS lists</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          The lists that payments, charges, freight, documents and Item Location pick from. Changes apply to new
          rows; existing rows keep their option.
        </p>
      </div>
      <TabGroup variant="pill" size="sm" activeTab={showSigners ? SIGNERS_TAB : optionList} onChange={setList} tabs={tabs} />
      {showSigners ? <IpasSignerListEditor /> : <IpasOptionListEditor key={optionList} list={optionList} />}
    </div>
  );
}
