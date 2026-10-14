// The decider: one card that answers the two questions a person opens an IPAS
// with. "What can I do here": their own sign-offs as full-width buttons, green
// to approve, pale red to send back, nothing they would be refused. "Where does
// it stand": the gates as one chain, with who passed each and when.

import { Button } from "@/components/ui/button";
import { ApprovalChain } from "@/components/ui/DetailParts";
import { IPAS_COMPUTATION_STATUS_LABELS, IPAS_SIGNOFF_ROLE, IPAS_SIGNOFF_ROLE_LABELS, ipasSectionLabel } from "@/constants/ipas";
import { cn } from "@/lib/utils";
import { APPROVE_CLASS } from "@/pages/approvals/_components/approvalUi";
import { movesFor } from "./moves";
import { Caption } from "./parts";

const name = (signoff) => signoff?.signedBy?.name ?? "someone";

/** The IPAS as a chain of gates, each one who passed it, or who it waits on. */
function gatesOf(digest, ipas) {
  const section = (part, state) => ({
    label: ipasSectionLabel(part),
    who: state.approved
      ? `Approved by ${name(state.approved)}`
      : state.prepared
        ? `Prepared by ${name(state.prepared)}, waiting for an approver`
        : "Waiting for Purchasing to prepare it",
    at: state.approved?.signedAt ?? null,
    state: state.approved ? "done" : digest.open ? "current" : "next",
  });
  const s7 = digest.s7;
  const filing = ipasSectionLabel("filing");
  const given = (role, label) => ({
    label,
    who: s7[role] ? name(s7[role]) : `${filing}, waiting`,
    at: s7[role]?.signedAt ?? null,
    state: s7[role] ? "done" : digest.open && s7.next.includes(role) ? "current" : "next",
  });
  const notedAndChecked = Boolean(s7.noted && s7.checked);
  return [
    section("purchasing", digest.s1),
    section("finance", digest.s3),
    {
      label: ipasSectionLabel("costing"),
      who: `Computation status: ${IPAS_COMPUTATION_STATUS_LABELS[ipas.computationStatus]}`,
      at: null,
      state: digest.costsComplete ? "done" : digest.open ? "current" : "next",
    },
    given(IPAS_SIGNOFF_ROLE.RECEIVED, `${filing}: ${IPAS_SIGNOFF_ROLE_LABELS[IPAS_SIGNOFF_ROLE.RECEIVED]}`),
    {
      label: `${filing}: Noted and Checked`,
      who: notedAndChecked
        ? `${name(s7.noted)} and ${name(s7.checked)}`
        : s7.noted
          ? `Noted by ${name(s7.noted)}, Checked still open`
          : s7.checked
            ? `Checked by ${name(s7.checked)}, Noted still open`
            : "Noted and Checked, in either order",
      at: notedAndChecked ? s7.checked.signedAt : null,
      state: notedAndChecked ? "done" : digest.open && s7.received ? "current" : "next",
    },
    given(IPAS_SIGNOFF_ROLE.APPROVED, `${filing}: Approved and filed`),
  ];
}

const MOVE = {
  primary: { variant: "default", className: "" },
  approve: { variant: "default", className: APPROVE_CLASS },
  outline: { variant: "outline", className: "" },
};

export default function DecisionCard({ ctx, digest }) {
  const { ipas, busy } = ctx;
  const { moves, returns } = movesFor(ctx, digest);
  const gates = gatesOf(digest, ipas);
  const waiting = digest.todo[0];
  const isBusy = busy.signoff || busy.give;

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="space-y-3 p-5">
        <Caption>Your move</Caption>
        {moves.length > 0 ? (
          <div className="space-y-2">
            {moves.map(({ key, kind, icon: Icon, label, run }) => (
              <Button
                key={key}
                variant={MOVE[kind].variant}
                disabled={isBusy}
                onClick={run}
                className={cn("h-11 w-full justify-center gap-2 text-sm font-semibold", MOVE[kind].className)}
              >
                <Icon size={16} />
                {label}
              </Button>
            ))}
          </div>
        ) : (
          <div>
            <p className="text-sm font-semibold text-foreground">
              {digest.filed
                ? "Filed. Nothing left to do."
                : digest.cancelled
                  ? "Cancelled. Nothing to do."
                  : "Nothing needs you right now."}
            </p>
            {waiting && digest.open && <p className="mt-1 text-sm text-muted-foreground">Waiting on {waiting.owner}.</p>}
          </div>
        )}
        {returns.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {returns.map(({ key, icon: Icon, label, run }) => (
              <Button key={key} variant="destructive" size="sm" disabled={isBusy} onClick={run} className="flex-1 gap-1.5">
                <Icon size={14} />
                {label}
              </Button>
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-border p-5">
        <Caption className="mb-4">
          Where it stands · {gates.filter((gate) => gate.state === "done").length} of {gates.length}
        </Caption>
        <ApprovalChain chain={gates} />
      </div>

      <dl className="space-y-2.5 border-t border-border bg-muted/30 p-5 text-sm">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-muted-foreground">Documents in hand</dt>
          <dd className="font-medium tabular-nums">
            {digest.docs.ticked} of {digest.docs.total}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-muted-foreground">Buyer track</dt>
          <dd className="font-medium tabular-nums">
            {digest.track.done} of {digest.track.total}
          </dd>
        </div>
      </dl>
    </div>
  );
}
