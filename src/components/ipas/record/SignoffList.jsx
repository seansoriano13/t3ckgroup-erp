import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ipasErrorMessage } from "@/utils/ipas";
import SignReview, { signIt } from "./SignReview";

/**
 * Every sign-off of the final IPAS, Logistics first, each with who gave it or who gives it.
 * The row of the person whose turn it is has the Sign button: it opens the review window
 * (the final IPAS as it prints) and signs from there. A refusal is said at the row.
 */
export default function SignoffList({ ctx, steps }) {
  const [reviewing, setReviewing] = useState(null);
  const [problem, setProblem] = useState(null);
  const busy = Boolean(ctx?.busy?.signoff || ctx?.busy?.give);

  const sign = async (item) => {
    setProblem(null);
    try {
      await signIt(ctx.on, item);
    } catch (error) {
      setProblem({ key: item.key, message: ipasErrorMessage(error) });
      throw error;
    }
  };

  return (
    <>
      <ol className="divide-y divide-border rounded-xl border border-border">
        {steps.map((step, index) => (
          <li
            key={step.key}
            id={`ipas-signoff-${step.key}`}
            className="flex items-start gap-3 px-3 py-2.5 text-sm transition-colors duration-500 data-[highlighted=true]:bg-amber-3"
          >
            <span className={`mt-0.5 font-mono text-xs ${step.done ? "text-green-11" : "text-muted-foreground"}`}>
              {step.done ? "✓" : index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-foreground">{step.label}</p>
              <p className="text-xs text-muted-foreground">{step.done ? step.line : `Who: ${step.who.names}`}</p>
              {problem?.key === step.key && (
                <p role="alert" className="mt-1 text-xs font-medium text-red-11">
                  {problem.message}
                </p>
              )}
            </div>
            {step.action && !step.done && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => { setProblem(null); setReviewing(step); }}>
                Sign
              </Button>
            )}
          </li>
        ))}
      </ol>
      {ctx && <SignReview ctx={ctx} item={reviewing} onClose={() => setReviewing(null)} onSign={sign} />}
    </>
  );
}
