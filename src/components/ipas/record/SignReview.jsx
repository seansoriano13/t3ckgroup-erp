// The review window every sign-off opens: the final IPAS form, then the one
// button that signs it. Shared by the rail and section 4 · Delivery.

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { APPROVE_CLASS } from "@/components/ui/approveClass";
import ModalShell from "@/components/ui/ModalShell";
import { ipasErrorMessage } from "@/utils/ipas";
import { PreviewFrame } from "./PrintPreview";

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
            size="lg"
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
      {problem && (
        <p role="alert" className="border-b border-red-7 bg-red-3/40 px-5 py-2 text-sm font-medium text-red-11">
          {problem}
        </p>
      )}
      <div className="min-h-0 flex-1 bg-mauve-4">{item && <PreviewFrame ctx={ctx} filingCopy={false} />}</div>
    </ModalShell>
  );
}
