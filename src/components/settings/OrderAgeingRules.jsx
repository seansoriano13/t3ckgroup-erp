import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import PageLoading from "../ui/PageLoading";
import QueryError from "../ui/QueryError";
import { orderMonitoringService } from "../../services/orderMonitoringService";
import { ORDER_AGEING_HINTS, ORDER_AGEING_STEPS } from "../../constants/orderMonitoring";
import { ipasErrorMessage } from "../../utils/ipas";

const RULES_KEY = ["order-monitoring", "ageing-rules"];
const INVALID_DAYS = "Days must be a whole number above zero, or blank for no rule.";

/** Blank is no rule (null); digits are days; anything else is NaN and refused. */
function parseDays(text) {
  const trimmed = String(text).trim();
  if (trimmed === "") return null;
  return /^\d+$/.test(trimmed) ? Number(trimmed) : NaN;
}

function isValidDays(days) {
  return days === null || (Number.isInteger(days) && days > 0);
}

/**
 * The Ageing rules section of Settings > Purchasing (#262, spec #261): one
 * number of days per step of an order's life, blank for no rule. A step with
 * no rule never goes late. Import Clearance 3 and Create Bill 7 are shown as
 * examples only; nothing is set from them. Purchasing access and Super Admins
 * edit it (the database decides).
 */
export default function OrderAgeingRules() {
  const queryClient = useQueryClient();
  const [edits, setEdits] = useState({});
  const [error, setError] = useState(null);

  const { data: rules, isLoading, isError, refetch } = useQuery({
    queryKey: RULES_KEY,
    queryFn: () => orderMonitoringService.getRules(),
  });

  const save = useMutation({
    mutationFn: (changes) =>
      Promise.all(changes.map((change) => orderMonitoringService.setRule(change.step, change.days))),
    onSuccess: () => {
      setEdits({});
      setError(null);
      toast.success("Ageing rules saved.");
      queryClient.invalidateQueries({ queryKey: RULES_KEY });
    },
    onError: (err) => toast.error(ipasErrorMessage(err)),
  });

  const textOf = (rule) => {
    if (rule.step in edits) return edits[rule.step];
    return rule.days === null ? "" : String(rule.days);
  };

  const onSave = () => {
    const parsed = (rules || [])
      .filter((rule) => rule.step in edits)
      .map((rule) => ({ step: rule.step, days: parseDays(edits[rule.step]), was: rule.days }));

    if (parsed.some((item) => !isValidDays(item.days))) {
      setError(INVALID_DAYS);
      return;
    }
    const changes = parsed.filter((item) => item.days !== item.was);
    if (changes.length === 0) {
      setEdits({});
      setError(null);
      return;
    }
    setError(null);
    save.mutate(changes);
  };

  return (
    <section className="space-y-4 border-t border-border pt-6" aria-labelledby="ageing-rules-heading">
      <div>
        <h2 id="ageing-rules-heading" className="text-sm font-semibold text-foreground">
          Ageing rules
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          How many days an order may sit at each step before it counts as late. A blank step has no rule and never goes
          late. Late orders are grouped under Needs chasing; nothing is blocked and nobody is notified.
        </p>
      </div>

      {isLoading && <PageLoading label="the ageing rules" />}
      {isError && <QueryError title="The ageing rules could not be loaded." onRetry={refetch} />}

      {rules && (
        <>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {ORDER_AGEING_STEPS.map((step) => {
              const rule = rules.find((candidate) => candidate.step === step.key);
              const hint = ORDER_AGEING_HINTS[step.key];
              return (
                <li key={step.key} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                  <span className="min-w-0 flex-1 text-sm text-foreground">{step.label}</span>
                  {hint !== undefined && (
                    <span className="text-xs text-muted-foreground">Example: {hint} days</span>
                  )}
                  <Input
                    type="number"
                    min={1}
                    step={1}
                    inputMode="numeric"
                    className="w-24"
                    placeholder="No rule"
                    aria-label={`Days for ${step.label}`}
                    value={textOf(rule ?? { step: step.key, days: null })}
                    onChange={(e) => {
                      setError(null);
                      setEdits((current) => ({ ...current, [step.key]: e.target.value }));
                    }}
                  />
                </li>
              );
            })}
          </ul>

          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}

          <div className="flex justify-end">
            <Button
              type="button"
              onClick={onSave}
              disabled={save.isPending || Object.keys(edits).length === 0}
            >
              Save ageing rules
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
