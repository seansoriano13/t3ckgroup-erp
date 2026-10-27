import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { AlertTriangle, BadgeCheck } from "lucide-react";

import ModalShell from "./ui/ModalShell";
import { Button } from "./ui/button";
import { CAPTION_BASE } from "@/lib/captionStyle";
import { canvassService } from "../services/canvassService";
import { CANVASS_LIST_KEY } from "../constants/canvass";
import { procurementQueueKey } from "./purchase-request/queryKeys";
import { moreOffersWarning } from "../utils/canvassMath";

/**
 * Signing a Canvass off (#279): the purchasing approver reads the winner and the reason, sees the
 * under-three warning when there is one (it never blocks), and confirms. The same dialog serves the
 * Canvass panel and the Approval Center queue, so it takes a plain summary rather than a Canvass:
 * the queue's list member may not be able to read the Costing Matrix at all.
 *
 * `summary`: { id, number, subjectLabel, reason, offerCount, winnerLabel }.
 *
 * A signature changes the Canvass wherever it is cached, not only where it was signed: the same
 * Canvass sits under its id, its Requested Item and its Component, in the Canvasses list, on its
 * request's line and on the Purchasing Dashboard. Every copy is marked signed at once and refetched.
 */
function refreshSignedCanvass(queryClient, canvassId, signedOffAt) {
  queryClient.setQueriesData({ queryKey: ["canvass"] }, (old) =>
    old && !Array.isArray(old) && old.id === canvassId ? { ...old, signed_off_at: signedOffAt ?? old.signed_off_at } : old,
  );
  for (const queryKey of [["canvass"], CANVASS_LIST_KEY, ["canvassSignoffQueue"], ["purchase-request"], procurementQueueKey, ["purchasing-dashboard"]]) {
    queryClient.invalidateQueries({ queryKey });
  }
  queryClient.invalidateQueries({ predicate: ({ queryKey }) => queryKey[0] === "costing" && queryKey[2] === "canvasses" });
}

export default function CanvassSignoffDialog({ open, onOpenChange, summary, onSigned }) {
  const queryClient = useQueryClient();
  const reason = String(summary?.reason ?? "").trim();
  const warning = moreOffersWarning(new Array(summary?.offerCount ?? 0));

  const signMutation = useMutation({
    mutationFn: () => canvassService.sign(summary.id),
    onSuccess: (result) => {
      toast.success(`${result?.number || summary.number} signed off.`);
      refreshSignedCanvass(queryClient, summary.id, result?.signed_off_at);
      onSigned?.(result);
      onOpenChange(false);
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      crumbs={["Canvass", summary?.number, "Sign off"].filter(Boolean)}
      title={`Sign off Canvass ${summary?.number ?? ""}`.trim()}
      actions={
        <Button
          type="button"
          size="lg"
          disabled={!reason || signMutation.isPending}
          onClick={() => signMutation.mutate()}
        >
          {signMutation.isPending ? "Signing…" : warning ? "Sign off anyway" : "Sign off"}
        </Button>
      }
    >
      <p className="flex items-center gap-2 text-base font-medium">
        <BadgeCheck size={16} aria-hidden="true" />
        Sign off Canvass {summary?.number}
      </p>
      <p className="text-sm text-muted-foreground">
        {summary?.subjectLabel ? `${summary.subjectLabel}. ` : ""}Your signature says you approve the supplier and product chosen below.
      </p>
      <div className="space-y-3 text-sm">
          <div className="space-y-0.5">
            <span className={`${CAPTION_BASE} tracking-wider text-muted-foreground`}>Winner</span>
            <p className="font-semibold text-foreground">{summary?.winnerLabel || "—"}</p>
          </div>

          <div className="space-y-0.5">
            <span className={`${CAPTION_BASE} tracking-wider text-muted-foreground`}>Why this supplier</span>
            {reason ? (
              <p className="whitespace-pre-wrap text-foreground" data-testid="signoff-reason">{reason}</p>
            ) : (
              <p className="text-red-11" data-testid="signoff-reason-missing">
                No reason has been given, so this can't be signed yet.
              </p>
            )}
          </div>

          {warning && (
            <p
              className="flex items-start gap-1.5 rounded-lg bg-amber-a3 px-2.5 py-2 text-[13px] font-semibold text-amber-11"
              role="alert"
              data-testid="signoff-warning"
            >
              <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
              {warning}
            </p>
          )}
        </div>

    </ModalShell>
  );
}
