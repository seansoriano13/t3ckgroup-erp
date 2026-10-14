import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CircleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ipasService } from "../../services/ipasService";
import {
  IPAS_DOCUMENT_APPLIES_TO_LABELS,
  IPAS_DOCUMENT_USED_FOR_LABELS,
  ipasSectionLabel,
} from "../../constants/ipas";
import { ipasFilingWarningsKey } from "./ipasKeys";

/**
 * Approving section 7 files the IPAS (#248): one deliberate act that freezes
 * it. This is where the page and the Approval Center ask for it. The required
 * documents nobody has ticked only warn: they are listed, and filing goes
 * ahead on confirm. LC Odoo Done is not a warning (the database refuses
 * Approved before it, and the page doesn't offer the button until then).
 *
 * `onConfirm()` returns a promise (the caller calls `ipasService.sign(...,
 * { confirm: true })` and words a failure with a toast); the dialog closes
 * when it resolves. It is mounted only while open.
 */
export default function FilingDialog({ open, onOpenChange, ipasId, number, onConfirm, summary, signer }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <Body
          ipasId={ipasId}
          number={number}
          onConfirm={onConfirm}
          summary={summary}
          signer={signer}
          onClose={() => onOpenChange(false)}
        />
      )}
    </Dialog>
  );
}

function Body({ ipasId, number, onConfirm, summary, signer, onClose }) {
  const [saving, setSaving] = useState(false);

  // Read fresh every time the dialog opens: what is ticked may have moved.
  const warnings = useQuery({
    queryKey: ipasFilingWarningsKey(ipasId),
    queryFn: () => ipasService.filingWarnings(ipasId),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });

  const submit = async () => {
    setSaving(true);
    try {
      await onConfirm();
      onClose();
    } catch {
      // The caller toasts; keep the dialog open.
    } finally {
      setSaving(false);
    }
  };

  const unticked = warnings.data ?? [];

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader className="shrink-0 pr-10">
        <DialogTitle>File {number}?</DialogTitle>
        <DialogDescription>
          Approving section {ipasSectionLabel(7)} files this IPAS. It freezes Landed Cost as final and locks its payments, charges,
          documents, bank details, SORs and Purpose. Only a Super Admin can reopen it.
        </DialogDescription>
        {/* From the record page: what filing adds, and who signs (the Approval Center passes neither). */}
        {summary && <p className="text-sm text-foreground">{summary}</p>}
        {signer && <p className="text-sm font-medium text-foreground">{signer}</p>}
      </DialogHeader>

      {warnings.isLoading ? (
        <p className="text-sm text-muted-foreground" role="status">
          Checking the documents…
        </p>
      ) : warnings.isError ? (
        <p className="text-sm text-muted-foreground" role="status">
          The documents couldn&apos;t be checked just now. You can still file it.
        </p>
      ) : unticked.length > 0 ? (
        <div
          role="status"
          data-testid="ipas-filing-warnings"
          className="rounded-xl border border-amber-400 bg-amber-3/40 p-3 text-[13px] text-amber-11"
        >
          <p className="flex items-center gap-1.5 font-semibold">
            <CircleAlert size={15} aria-hidden="true" />
            {unticked.length === 1 ? "1 required document isn't ticked" : `${unticked.length} required documents aren't ticked`}
          </p>
          <ul className="mt-1.5 space-y-0.5 text-xs">
            {unticked.map((doc) => (
              <li key={doc.id}>
                <span className="font-medium">{doc.label}</span>
                <span className="opacity-80">
                  {" "}
                  · {IPAS_DOCUMENT_APPLIES_TO_LABELS[doc.appliesTo] ?? doc.appliesTo} ·{" "}
                  {(IPAS_DOCUMENT_USED_FOR_LABELS[doc.usedFor] ?? doc.usedFor ?? "").toLowerCase()}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs opacity-90">You can still file it. Neither tick is needed to go ahead.</p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground" role="status">
          Every required document is ticked.
        </p>
      )}

      <DialogFooter>
        <Button variant="outline" size="lg" onClick={onClose}>
          Cancel
        </Button>
        <Button size="lg" disabled={saving || warnings.isLoading} onClick={submit}>
          {saving ? "Filing…" : unticked.length > 0 ? "File anyway" : "Approve and file"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
