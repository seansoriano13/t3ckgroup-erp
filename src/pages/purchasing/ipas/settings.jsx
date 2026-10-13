import { useState } from "react";
import { Link } from "react-router";
import { ArrowLeft } from "lucide-react";

import ProtectedRoute from "../../../components/ProtectedRoute";
import PageShell from "../../../components/ui/PageShell";
import TabGroup from "../../../components/ui/TabGroup";
import IpasOptionListEditor from "../../../components/ipas/IpasOptionListEditor";
import { IPAS_OPTION_LISTS, IPAS_OPTION_LIST_LABELS } from "../../../constants/ipas";

/**
 * IPAS settings (issue #244, spec #241): the option lists the business edits,
 * each starting from the sheet's values. Purchasing access and Super Admins add,
 * rename, reorder and deactivate; options are never deleted, and a deactivated
 * one stays on the rows that used it. The signer lists (Super Admins) join
 * this screen in the sign-off ticket.
 */
function IpasSettings() {
  const [list, setList] = useState(IPAS_OPTION_LISTS[0]);

  return (
    <PageShell
      title="IPAS settings"
      description="The lists payments, charges and freight pick from. Changes apply to new rows; existing rows keep their option."
      frame="narrow"
      action={
        <Link
          to="/purchasing/ipas"
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-mauve-3 hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          IPAS
        </Link>
      }
      tabs={
        <TabGroup
          variant="pill"
          size="sm"
          activeTab={list}
          onChange={setList}
          tabs={IPAS_OPTION_LISTS.map((value) => ({ value, label: IPAS_OPTION_LIST_LABELS[value] }))}
        />
      }
    >
      <IpasOptionListEditor key={list} list={list} />
    </PageShell>
  );
}

// Purchasing access or a Super Admin; the database refuses anyone else's write.
export default function IpasSettingsPage() {
  return (
    <ProtectedRoute requirePurchasing>
      <IpasSettings />
    </ProtectedRoute>
  );
}
