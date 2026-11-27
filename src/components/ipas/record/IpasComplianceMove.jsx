// The Compliance Requirement group of the IPAS's Your move (#1251, spec #1247).
// Unanswered: the question, Yes and No. Yes opens a picker of the active kinds. After Yes: one line per
// open kind, and a way to change the answer or the kinds. "Mark done" is #1256's; this file only lists.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";

import InlineError from "@/components/record/InlineError";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldBox } from "@/components/ui/FieldBox";
import { IPAS_COMPLIANCE_QUESTION, IPAS_OPTION_LIST } from "@/constants/ipas";
import { ipasService } from "@/services/ipasService";
import { ipasErrorMessage } from "@/utils/ipas";
import { ipasKey, ipasOptionsKey, markIpasListStale } from "../ipasKeys";

/** The picker: the active kinds, plus any retired kind the IPAS already holds (it stays until unpicked). */
function KindPicker({ ipasId, held, onSave, onNo, onCancel, saving, changing }) {
  const kinds = useQuery({
    queryKey: ipasOptionsKey(IPAS_OPTION_LIST.COMPLIANCE_KIND),
    queryFn: () => ipasService.complianceKinds(),
  });
  const [picked, setPicked] = useState(() => new Set(held.map((kind) => kind.kindId)));

  const choices = [
    ...(kinds.data ?? []).map((kind) => ({ id: kind.id, label: kind.label })),
    ...held.filter((kind) => !(kinds.data ?? []).some((active) => active.id === kind.kindId)).map((kind) => ({ id: kind.kindId, label: kind.label })),
  ];
  const toggle = (id, on) =>
    setPicked((previous) => {
      const next = new Set(previous);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <div className="mt-2 space-y-2" data-testid={`ipas-compliance-picker-${ipasId}`}>
      <p className="text-xs text-muted-foreground">Pick one or more.</p>
      {kinds.isError ? (
        <p className="text-xs font-medium text-red-11">The kinds could not be loaded.</p>
      ) : (
        <ul className="space-y-1.5">
          {choices.map((choice) => (
            <li key={choice.id}>
              <FieldBox inline>
                <Checkbox checked={picked.has(choice.id)} onCheckedChange={(on) => toggle(choice.id, on === true)} />
                <span className="text-sm text-foreground">{choice.label}</span>
              </FieldBox>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={saving || picked.size === 0} onClick={() => onSave([...picked])}>
          {saving ? "Saving…" : "Save kinds"}
        </Button>
        {changing && (
          <Button size="sm" variant="outline" disabled={saving} onClick={onNo}>
            No, none needed
          </Button>
        )}
        <Button size="sm" variant="ghost" disabled={saving} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/**
 * `compliance` is `complianceFor(ctx)` (moves.js), never null here. The database decides in the end who may
 * answer; the group is only shown to people it will let.
 */
export default function IpasComplianceMove({ ipas, compliance }) {
  const queryClient = useQueryClient();
  // "picking": the kind picker is open; `changing`: it was opened from an answered state.
  const [picking, setPicking] = useState(false);
  const [failure, setFailure] = useState(null);

  const answer = useMutation({
    mutationFn: ({ needed, kindIds }) => ipasService.setCompliance(ipas.id, needed, kindIds),
    onSuccess: () => {
      setPicking(false);
      setFailure(null);
      toast.success("Compliance Requirements saved.");
    },
    onError: (error, variables) => setFailure({ message: ipasErrorMessage(error), variables }),
    // Nobody is told; the record and the list read again.
    onSettled: () => Promise.all([markIpasListStale(queryClient), queryClient.invalidateQueries({ queryKey: ipasKey(ipas.id) })]),
  });

  const { state, kinds, open } = compliance;
  const answered = state !== "unanswered";
  const saving = answer.isPending;
  const choose = (needed, kindIds = []) => answer.mutate({ needed, kindIds });

  return (
    <section className="mt-4 border-t border-border pt-3" aria-label="Compliance Requirements" data-testid="ipas-compliance-move">
      {state === "unanswered" && !picking && (
        <>
          <p className="text-sm font-semibold text-foreground">{IPAS_COMPLIANCE_QUESTION}</p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setPicking(true)}>
              Yes
            </Button>
            <Button size="sm" variant="outline" disabled={saving} onClick={() => choose(false)}>
              No
            </Button>
          </div>
        </>
      )}

      {state === "unanswered" && picking && (
        <>
          <p className="text-sm font-semibold text-foreground">{IPAS_COMPLIANCE_QUESTION}</p>
          <KindPicker ipasId={ipas.id} held={kinds} saving={saving} onSave={(ids) => choose(true, ids)} onCancel={() => setPicking(false)} />
        </>
      )}

      {answered && !picking && (
        <>
          {open.length > 0 ? (
            <>
              <p className="text-sm font-semibold text-foreground">Compliance Requirements</p>
              <ul className="mt-1.5 space-y-1">
                {open.map((kind) => (
                  <li key={kind.id} className="flex items-center gap-2 text-sm text-foreground" data-testid="ipas-compliance-open-kind">
                    <span className="font-medium">{kind.label}</span>
                    <span className="text-xs text-muted-foreground">open</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              Compliance Requirements: {state === "no" ? "none needed" : "all done"}.
            </p>
          )}
          <Button variant="link" className="mt-1 h-auto p-0 text-xs font-medium underline underline-offset-4" onClick={() => setPicking(true)}>
            Change answer or kinds
          </Button>
        </>
      )}

      {answered && picking && (
        <>
          <p className="text-sm font-semibold text-foreground">{IPAS_COMPLIANCE_QUESTION}</p>
          <KindPicker ipasId={ipas.id} held={kinds} changing saving={saving} onSave={(ids) => choose(true, ids)} onNo={() => choose(false)} onCancel={() => setPicking(false)} />
        </>
      )}

      {failure && (
        <InlineError
          message={failure.message}
          busy={saving}
          onRetry={() => answer.mutate(failure.variables)}
          onDismiss={() => setFailure(null)}
        />
      )}
    </section>
  );
}
