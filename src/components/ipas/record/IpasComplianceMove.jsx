// The Compliance Requirement group of the IPAS's Your move (#1251, spec #1247).
// Unanswered: the question, Yes and No. Yes opens a picker of the active kinds. After Yes: one line per
// open kind with Mark done (#1256: the day, never after today in Manila, and an optional note), and a way to
// change the answer or the kinds. That step also lists the done kinds: Undo a tick, or Edit its day and note.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";

import InlineError from "@/components/record/InlineError";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldBox } from "@/components/ui/FieldBox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { IPAS_COMPLIANCE_QUESTION, IPAS_OPTION_LIST } from "@/constants/ipas";
import { ipasService } from "@/services/ipasService";
import { ipasErrorMessage } from "@/utils/ipas";
import { IPAS_DATE_MIN, ipasDateIssue, ipasDateMax } from "@/utils/ipasDateLimits";
import { ipasKey, ipasOptionsKey, markIpasListStale } from "../ipasKeys";

const NOTE_MAX = 500;

/** 'YYYY-MM-DD' as "20 Nov 2026" (no time zone maths: the day is already a Manila day). */
const dayLabel = (day) => {
  const [year, month, date] = String(day).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date)).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
};

/** The small step of one kind: the day (today to start, never later) and an optional note. */
function TickStep({ kind, editing, saving, onSave, onCancel }) {
  const [day, setDay] = useState(() => kind.doneOn ?? ipasDateMax());
  const [note, setNote] = useState(() => kind.note ?? "");
  const issue = day === "" ? "Pick the day it was done." : ipasDateIssue(day, "The day");
  const tooLong = note.length > NOTE_MAX;
  const unchanged = editing && day === kind.doneOn && note.trim() === (kind.note ?? "");
  return (
    <div className="mt-2 space-y-2 rounded-lg border border-border p-2.5" data-testid={`ipas-compliance-step-${kind.id}`}>
      <div>
        <FieldBox label="Done on" bare>
          <Input type="date" min={IPAS_DATE_MIN} max={ipasDateMax()} value={day} onChange={(event) => setDay(event.target.value)} error={issue} />
        </FieldBox>
        {issue && <p className="mt-1 text-xs font-medium text-red-11">{issue}</p>}
      </div>
      <div>
        <Textarea
          label="Note (optional)"
          placeholder="Permit number, for example"
          rows={2}
          value={note}
          error={tooLong ? `Up to ${NOTE_MAX} characters.` : undefined}
          onChange={(event) => setNote(event.target.value)}
        />
        <p className={`mt-1 text-xs ${tooLong ? "font-medium text-red-11" : "text-muted-foreground"}`}>
          {note.length}/{NOTE_MAX}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={saving || Boolean(issue) || tooLong || unchanged} onClick={() => onSave(day, note)}>
          {saving ? "Saving…" : editing ? "Save" : "Mark done"}
        </Button>
        <Button size="sm" variant="ghost" disabled={saving} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

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
    onError: (error, variables) => setFailure({ message: ipasErrorMessage(error), retry: () => answer.mutate(variables) }),
    // Nobody is told; the record and the list read again.
    onSettled: () => Promise.all([markIpasListStale(queryClient), queryClient.invalidateQueries({ queryKey: ipasKey(ipas.id) })]),
  });

  // The kind whose Mark done / Edit step is open (one at a time).
  const [stepOf, setStepOf] = useState(null);
  const settle = () =>
    Promise.all([markIpasListStale(queryClient), queryClient.invalidateQueries({ queryKey: ipasKey(ipas.id) })]);
  const tick = useMutation({
    mutationFn: ({ kind, day, note }) => ipasService.tickCompliance(kind.id, day, note),
    onSuccess: (_row, { kind }) => {
      setStepOf(null);
      setFailure(null);
      toast.success(`${kind.label} marked done.`);
    },
    onError: (error, variables) => setFailure({ message: ipasErrorMessage(error), retry: () => tick.mutate(variables) }),
    onSettled: settle,
  });
  const untick = useMutation({
    mutationFn: ({ kind }) => ipasService.untickCompliance(kind.id),
    onSuccess: (_row, { kind }) => {
      setFailure(null);
      toast.success(`${kind.label} is open again.`);
    },
    onError: (error, variables) => setFailure({ message: ipasErrorMessage(error), retry: () => untick.mutate(variables) }),
    onSettled: settle,
  });

  const { state, kinds, open } = compliance;
  const done = kinds.filter((kind) => kind.doneOn);
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
                  <li key={kind.id} className="text-sm text-foreground" data-testid="ipas-compliance-open-kind">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{kind.label}</span>
                      <span className="text-xs text-muted-foreground">open</span>
                      {stepOf !== kind.id && (
                        <Button size="sm" variant="outline" className="ml-auto" aria-label={`Mark ${kind.label} done`} onClick={() => setStepOf(kind.id)}>
                          Mark done
                        </Button>
                      )}
                    </div>
                    {stepOf === kind.id && (
                      <TickStep kind={kind} saving={tick.isPending} onCancel={() => setStepOf(null)} onSave={(day, note) => tick.mutate({ kind, day, note })} />
                    )}
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
          {done.length > 0 && (
            <div className="mt-2" data-testid="ipas-compliance-done">
              <p className="text-xs font-medium text-muted-foreground">Done</p>
              <ul className="mt-1 space-y-1.5">
                {done.map((kind) => (
                  <li key={kind.id} className="text-sm text-foreground" data-testid="ipas-compliance-done-kind">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-medium">{kind.label}</span>
                      <span className="text-xs text-muted-foreground">done {dayLabel(kind.doneOn)}</span>
                      <span className="ml-auto flex gap-1">
                        <Button size="sm" variant="ghost" aria-label={`Edit ${kind.label} day and note`} disabled={untick.isPending} onClick={() => setStepOf(kind.id)}>
                          Edit
                        </Button>
                        <Button size="sm" variant="ghost" aria-label={`Undo ${kind.label} tick`} disabled={untick.isPending} onClick={() => untick.mutate({ kind })}>
                          Undo
                        </Button>
                      </span>
                    </div>
                    {kind.note && <p className="mt-0.5 break-words text-xs text-muted-foreground">{kind.note}</p>}
                    {stepOf === kind.id && (
                      <TickStep kind={kind} editing saving={tick.isPending} onCancel={() => setStepOf(null)} onSave={(day, note) => tick.mutate({ kind, day, note })} />
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <KindPicker ipasId={ipas.id} held={kinds} changing saving={saving} onSave={(ids) => choose(true, ids)} onNo={() => choose(false)} onCancel={() => setPicking(false)} />
        </>
      )}

      {failure && (
        <InlineError
          message={failure.message}
          busy={saving || tick.isPending || untick.isPending}
          onRetry={failure.retry}
          onDismiss={() => setFailure(null)}
        />
      )}
    </section>
  );
}
