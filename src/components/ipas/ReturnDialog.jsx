import { useState } from "react";
import { TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import ModalShell from "@/components/ui/ModalShell";
import { FieldBox } from "@/components/ui/FieldBox";
import { Textarea } from "@/components/ui/textarea";
import InlineError from "@/components/record/InlineError";
import { cn } from "@/lib/utils";
import { ipasErrorMessage } from "@/utils/ipas";

/**
 * The one place an IPAS section is returned or its approval undone.
 *
 *   targets   what the signed-in person may do, each
 *             { section, mode: "return" | "undo", no, label, effect, clears, placeholder? }:
 *             `label` is "1 · Purchasing", `effect` says what it does,
 *             `clears` lists what else it clears ("Received by Ana", ...) and
 *             is empty when nothing else goes
 *   initial   the section to start on (the drawer's), else the first target
 *   onSubmit({ section, mode, reason })  returns a promise; the dialog closes
 *             when it resolves
 *
 * A Return sends a submitted section back to its submitter; Undo approval takes
 * back an approval and leaves Submitted. Both need a reason. When the choice
 * would clear section 4's sign-offs the dialog names who gave them and asks
 * for a second, deliberate click, because they may be hard to get again.
 * Mounted only while open, so it always starts empty.
 */
export default function ReturnDialog({ open, onOpenChange, ...body }) {
  return open ? <Body {...body} onClose={() => onOpenChange(false)} /> : null;
}

const verbOf = (target) => (target.mode === "undo" ? "Undo approval" : "Return");
const titleOf = (target) =>
  target.mode === "undo" ? `Undo approval of section ${target.no}?` : `Return section ${target.no}?`;

function Body({ targets, initial = null, onSubmit, onClose }) {
  const [section, setSection] = useState(
    targets.some((t) => t.section === initial) ? initial : (targets[0]?.section ?? null),
  );
  const [reason, setReason] = useState("");
  const [understood, setUnderstood] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState(null);

  const target = targets.find((t) => t.section === section) ?? targets[0];
  if (!target) return null;
  const trimmed = reason.trim();
  const clears = target.clears ?? [];
  const needsAck = clears.length > 0;
  const ready = trimmed !== "" && (!needsAck || understood);
  const single = targets.length === 1;

  const submit = async () => {
    setSaving(true);
    setFailure(null);
    try {
      await onSubmit({ section: target.section, mode: target.mode, reason: trimmed });
      onClose();
    } catch (error) {
      setFailure(ipasErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell
      open
      onOpenChange={(next) => !next && onClose()}
      crumbs={["IPAS", single ? titleOf(target) : "Return or undo an approval"]}
      title={single ? titleOf(target) : "Return or undo an approval"}
      actions={
        <Button size="lg" variant="destructive" disabled={!ready || saving} onClick={submit}>
          {saving ? "Working…" : verbOf(target)}
        </Button>
      }
    >
      <p className="text-sm text-muted-foreground">
        {single ? target.effect : "Pick the section, then say why. The history keeps what was cleared."}
      </p>

      {!single && (
        <div role="radiogroup" aria-label="Section" className="flex flex-col gap-2">
          {targets.map((item) => {
            const picked = item.section === target.section;
            return (
              <Button
                key={item.section}
                type="button"
                role="radio"
                aria-checked={picked}
                variant="outline"
                onClick={() => {
                  setSection(item.section);
                  setUnderstood(false);
                }}
                className={cn(
                  "h-auto flex-col items-start gap-0 whitespace-normal px-3 py-2.5 text-left",
                  picked && "border-foreground bg-muted",
                )}
              >
                <span className="text-sm font-semibold">
                  {verbOf(item)} · {item.label}
                </span>
                <span className="text-xs font-normal text-muted-foreground">{item.effect}</span>
              </Button>
            );
          })}
        </div>
      )}

      {needsAck && (
        <div
          role="alert"
          className="space-y-2 rounded-lg border border-amber-7 bg-amber-2 px-3 py-2.5 text-sm text-amber-11"
        >
          <p className="flex items-center gap-2 font-semibold">
            <TriangleAlert size={14} aria-hidden="true" />
            This also clears sign-offs that may be hard to get again
          </p>
          <ul className="list-disc pl-5 text-xs">
            {clears.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <FieldBox inline className="text-xs font-medium">
            <Checkbox checked={understood} onCheckedChange={(next) => setUnderstood(Boolean(next))} />
            They will have to be given again
          </FieldBox>
        </div>
      )}

      <FieldBox label="Reason" bare>
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          maxLength={500}
          placeholder={
            target.placeholder ??
            (target.mode === "undo" ? "Why is this approval being taken back?" : "What does the submitter need to fix?")
          }
          autoFocus
        />
      </FieldBox>

      {failure && <InlineError message={failure} busy={saving} onRetry={submit} onDismiss={() => setFailure(null)} />}
    </ModalShell>
  );
}
