import { Pencil, TriangleAlert } from "lucide-react";

import { Button } from "../ui/button";
import { DetailRow } from "../ui/DetailParts";
import SectionHeader from "../ui/SectionHeader";
import StatusBadge from "../StatusBadge";

/**
 * Bank details inside section 3 (#245): Bank Name, Account Name and Account #,
 * with the changed-account flag beside the account. Rendered only for people
 * the database lets read them (`ipas.canReadBankDetails`); a section 7 signer
 * without flags never sees the block, and the database refuses the rows anyway.
 *
 *   canChange   Purchasing on an open IPAS. Finance reads but never types them.
 */
export function IpasBankDetails({ ipas, canChange = false, onEdit }) {
  if (!ipas.canReadBankDetails) return null;
  const bank = ipas.bankDetails;
  const flagged = Boolean(bank?.flagged);

  return (
    <div className="mt-5 space-y-3" data-testid="ipas-bank-details">
      <SectionHeader title="Bank details" className="pb-2">
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
          className="flex items-start gap-2 rounded-xl border border-red-400 bg-red-3/40 p-3 text-[13px] text-red-11"
        >
          <TriangleAlert size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-semibold">Account # changed</p>
            <p className="mt-0.5 text-xs opacity-90">
              It differs from this supplier&apos;s last IPAS. Confirm it with the supplier before anyone approves or
              pays. Any approvals given on sections 1 and 3 were cleared.
            </p>
          </div>
        </div>
      )}

      {bank ? (
        <dl className="grid grid-cols-1 gap-x-8 divide-y divide-border sm:grid-cols-2 sm:divide-y-0">
          <DetailRow label="Bank Name">{bank.bankName}</DetailRow>
          <DetailRow label="Account Name">{bank.accountName}</DetailRow>
          <DetailRow label="Account #">
            <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="tabular-nums">{bank.accountNumber ?? "—"}</span>
              {flagged && <StatusBadge theme="red" label="Changed account" />}
            </span>
          </DetailRow>
        </dl>
      ) : (
        <p className="rounded-lg border border-dashed border-border px-4 py-4 text-sm text-muted-foreground">
          No bank details typed yet.
        </p>
      )}
    </div>
  );
}
