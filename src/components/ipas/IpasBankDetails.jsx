import { Pencil, TriangleAlert } from "lucide-react";

import { Button } from "../ui/button";
import DetailGrid from "@/components/record/DetailGrid";
import SectionHeader from "../ui/SectionHeader";
import StatusBadge from "../StatusBadge";
import { ipasSectionLabel } from "../../constants/ipas";
import { useEditable } from "@/components/record/sectionChrome";

/**
 * Bank details inside section 3 (#245): Bank Name, Account Name and Account #,
 * with the changed-account flag beside the account. Rendered only for people
 * the database lets read them (`ipas.canReadBankDetails`); a section 7 signer
 * without flags never sees the block, and the database refuses the rows anyway.
 *
 *   canChange   Purchasing on an open IPAS. Finance reads but never types them.
 */
export function IpasBankDetails({ ipas, canChange: granted = false, onEdit }) {
  const canChange = useEditable(granted);
  if (!ipas.canReadBankDetails) return null;
  const bank = ipas.bankDetails;
  const flagged = Boolean(bank?.flagged);

  return (
    <div className="mt-5 space-y-3" data-testid="ipas-bank-details">
      <SectionHeader title="Bank details" className="border-b-0 pb-2">
        {canChange && (
          <Button size="sm" variant="outline" className="gap-1.5" onClick={onEdit}>
            <Pencil size={14} />
            {bank ? "Edit bank details" : "Add bank details"}
          </Button>
        )}
      </SectionHeader>

      {flagged && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-red-7 bg-red-3/40 p-3 text-sm text-red-11"
        >
          <TriangleAlert size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-semibold">Account # changed</p>
            <p className="mt-0.5 text-xs opacity-90">
              It differs from this supplier&apos;s last IPAS. Confirm it with the supplier before anyone approves or
              pays. Any approval given on section {ipasSectionLabel(3)} was cleared.
            </p>
          </div>
        </div>
      )}

      {bank ? (
        <DetailGrid
          items={[
            { label: "Bank Name", value: bank.bankName },
            { label: "Account Name", value: bank.accountName },
            {
              label: "Account #",
              value: (
                <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="tabular-nums">{bank.accountNumber ?? "—"}</span>
                  {flagged && <StatusBadge theme="red" label="Changed account" />}
                </span>
              ),
            },
          ]}
        />
      ) : (
        <p className="text-[13px] text-muted-foreground">No bank details typed yet.</p>
      )}
    </div>
  );
}
