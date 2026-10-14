import { Check, CornerUpLeft, PenLine } from "lucide-react";

import { Button } from "../ui/button";
import SectionHeader from "../ui/SectionHeader";
import StatusBadge from "../StatusBadge";
import { IPAS_SIGNOFF_ROLE, IPAS_SIGNOFF_ROLE_LABELS } from "../../constants/ipas";
import { SIGNOFF_STATUS } from "../../utils/ipasSignoffs";
import { formatDate } from "../../utils/formatDate.js";

const STATUS_BADGE = {
  [SIGNOFF_STATUS.NOT_PREPARED]: { theme: "mauve", label: "Not prepared" },
  [SIGNOFF_STATUS.AWAITING_APPROVAL]: { theme: "amber", label: "Awaiting approval" },
  [SIGNOFF_STATUS.APPROVED]: { theme: "green", label: "Approved" },
};

const WHY_NOT = {
  preparer: "You prepared this section, so someone else approves it.",
};

/** One box of the sign-off pair: who gave it and when, or that it is waiting. */
export function SignoffBox({ section, role, signoff, waiting }) {
  return (
    <div
      className="rounded-lg border border-border bg-muted/20 px-3 py-2.5"
      data-testid={`ipas-signoff-${section}-${role}`}
    >
      <p className="text-label font-bold uppercase tracking-wider text-muted-foreground">
        {IPAS_SIGNOFF_ROLE_LABELS[role]}
      </p>
      {signoff ? (
        <>
          <p className="mt-1 flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
            <Check size={14} className="text-green-11" aria-hidden="true" />
            {signoff.signedBy?.name ?? "Someone"}
          </p>
          <p className="text-xs text-muted-foreground">
            {formatDate(signoff.signedAt)}
            {signoff.signatureDeclined ? " · signed without a signature" : ""}
          </p>
        </>
      ) : (
        <p className="mt-1 text-[13px] text-muted-foreground">{waiting}</p>
      )}
    </div>
  );
}

/**
 * A section's sign-offs (#247), at the foot of section 1 and of section 3:
 * Prepared and Approved with who gave them, what the viewer may do, and the
 * history of what was cleared and why. Actions follow `rights`
 * (utils/ipasSignoffs.signoffRights): the database refuses anything else, so
 * this only spares people a button that would fail.
 *
 *   state      ipas.signoffSections[section]
 *   rights     signoffRights(...) for the signed-in person
 *   busy       a sign-off is in flight
 */
export function IpasSignoffs({ section, state, rights, busy = false, onPrepare, onApprove, onSendBack }) {
  const badge = STATUS_BADGE[state.status];
  const hint = state.status === SIGNOFF_STATUS.AWAITING_APPROVAL ? WHY_NOT[rights.whyNotApprove] : null;

  return (
    <div className="mt-5 space-y-3" data-testid={`ipas-signoffs-${section}`}>
      <SectionHeader title="Sign-offs" className="pb-2">
        <StatusBadge theme={badge.theme} label={badge.label} />
        {rights.canPrepare && (
          <Button size="sm" className="gap-1.5" disabled={busy} onClick={onPrepare}>
            <PenLine size={14} />
            Prepare section {section}
          </Button>
        )}
        {rights.canApprove && (
          <Button size="sm" className="gap-1.5" disabled={busy} onClick={onApprove}>
            <Check size={14} />
            Approve section {section}
          </Button>
        )}
        {rights.canSendBack && (
          <Button size="sm" variant="outline" className="gap-1.5" disabled={busy} onClick={onSendBack}>
            <CornerUpLeft size={14} />
            Send back
          </Button>
        )}
      </SectionHeader>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <SignoffBox
          section={section}
          role={IPAS_SIGNOFF_ROLE.PREPARED}
          signoff={state.prepared}
          waiting="Purchasing marks it prepared when it is ready for approval."
        />
        <SignoffBox
          section={section}
          role={IPAS_SIGNOFF_ROLE.APPROVED}
          signoff={state.approved}
          waiting={state.prepared ? "Waiting for an approver on the list." : "After it is prepared."}
        />
      </div>

      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}

      {state.history.length > 0 && (
        <div className="space-y-1" data-testid={`ipas-signoff-history-${section}`}>
          <p className="text-xs font-semibold text-muted-foreground">Cleared</p>
          <ul className="space-y-0.5 text-xs text-muted-foreground">
            {state.history.map((entry) => (
              <li key={entry.id}>
                <span className="font-medium text-foreground">
                  {IPAS_SIGNOFF_ROLE_LABELS[entry.role]} by {entry.signedBy?.name ?? "someone"}
                </span>{" "}
                · cleared {formatDate(entry.clearedAt)} · {entry.clearedReason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
