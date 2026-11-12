// The review window every sign-off goes through: the final IPAS form as it prints, with the one
// button that signs it. It opens from the sign-off's own row in 6 · Sign-offs; nothing signs from the rail.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CircleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { APPROVE_CLASS } from "@/components/ui/approveClass";
import ModalShell from "@/components/ui/ModalShell";
import { ipasErrorMessage } from "@/utils/ipas";
import { fileRulesOf, missingDocumentsByPart } from "@/utils/ipasDocuments";
import { ipasService } from "@/services/ipasService";
import { ipasFilingWarningsKey } from "../ipasKeys";
import { PreviewFrame } from "./PrintPreview";

/** What signing an item does, by the kind of its action. */
export function signIt(on, item) {
  const { action } = item;
  if (action.kind === "sign") return on.signMany(action.steps);
  if (action.kind === "check") return on.signCheck();
  if (action.kind === "logistics") return on.signLogistics();
  return on.file();
}

/**
 * "Review and file" warns like the filing dialog does (#936): the required documents
 * nobody has ticked and the required files still missing. It only warns; the database
 * refuses a sign-off whose files are missing and names them.
 */
function FilingWarning({ ipas }) {
  const ticks = useQuery({
    queryKey: ipasFilingWarningsKey(ipas.id),
    queryFn: () => ipasService.filingWarnings(ipas.id),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  const byPart = missingDocumentsByPart(ipas.documents ?? [], ipas.payments ?? [], ipas.source, fileRulesOf(ipas));
  const files = [...byPart.purchasing, ...byPart.finance, ...byPart.costing, ...byPart.filing];
  const unticked = (ticks.data ?? []).map((doc) => doc.label);
  if (files.length === 0 && unticked.length === 0) return null;
  return (
    <div
      role="status"
      data-testid="ipas-review-warnings"
      className="border-b border-amber-400 bg-amber-3/40 px-5 py-2 text-[13px] text-amber-11"
    >
      <p className="flex items-center gap-1.5 font-semibold">
        <CircleAlert size={15} aria-hidden="true" />
        Required documents are missing
      </p>
      {files.length > 0 && <p className="mt-0.5 text-xs">No file attached: {files.join(", ")}.</p>}
      {unticked.length > 0 && <p className="mt-0.5 text-xs">Not ticked: {unticked.join(", ")}.</p>}
    </div>
  );
}

/** The final IPAS form, as it prints, with the one button that signs it. */
export default function SignReview({ ctx, item, onClose, onSign }) {
  const [working, setWorking] = useState(false);
  // A refusal stays here, beside the button, until the next try (a toast is gone in seconds).
  const [problem, setProblem] = useState(null);
  const { ipas, viewer } = ctx;
  const action = item?.action;
  return (
    <ModalShell
      open={Boolean(item)}
      onOpenChange={(next) => {
        if (next || working) return;
        setProblem(null);
        onClose();
      }}
      size="wide"
      expandable
      className="h-[90vh]"
      bodyClassName="gap-0 p-0"
      crumbs={["IPAS", ipas.number, item?.label ?? "Sign"]}
      cancelLabel="Not yet"
      actions={
        action && (
          <Button
           
            className={APPROVE_CLASS}
            disabled={working}
            onClick={async () => {
              setWorking(true);
              setProblem(null);
              try {
                await onSign(item);
                onClose();
              } catch (error) {
                setProblem(ipasErrorMessage(error));
              } finally {
                setWorking(false);
              }
            }}
          >
            {working ? "Signing…" : action.confirm}
          </Button>
        )
      }
    >
      <p className="border-b border-border px-5 py-2 text-xs text-muted-foreground">
        Read the final IPAS below. When you press <span className="font-semibold text-foreground">{action?.confirm}</span>, {action?.what}.
        {viewer ? ` You sign as ${viewer}.` : ""}
      </p>
      {action?.kind === "file" && <FilingWarning ipas={ipas} />}
      {problem && (
        <p role="alert" className="border-b border-red-7 bg-red-3/40 px-5 py-2 text-sm font-medium text-red-11">
          {problem}
        </p>
      )}
      <div className="min-h-0 flex-1 bg-mauve-4">{item && <PreviewFrame ctx={ctx} filingCopy={false} />}</div>
    </ModalShell>
  );
}
