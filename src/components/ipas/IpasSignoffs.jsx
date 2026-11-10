import { Check } from "lucide-react";

import DetailGrid from "@/components/record/DetailGrid";
import SectionHeader from "../ui/SectionHeader";
import StatusBadge from "../StatusBadge";
import { IPAS_SIGNOFF_ROLE, IPAS_SIGNOFF_ROLE_LABELS } from "../../constants/ipas";
import { SIGNOFF_STATUS } from "../../utils/ipasSignoffs";
import { formatDate } from "../../utils/formatDate.js";
import { useInDrawer } from "@/components/record/sectionChrome";

const STATUS_BADGE = {
  [SIGNOFF_STATUS.NOT_PREPARED]: { label: "Not submitted" },
  [SIGNOFF_STATUS.AWAITING_APPROVAL]: { label: "Awaiting approval" },
  [SIGNOFF_STATUS.APPROVED]: { label: "Approved" },
};

const WHY_NOT = {
  preparer: "You submitted this section, so someone else approves it.",
};

/** One slot of the sign-off pair, in the detail grid: who gave it and when, or that it is waiting. */
export function SignoffBox({ section, role, signoff, waiting }) {
  const value = signoff ? (
    <>
      <span className="flex items-center gap-1.5 font-semibold">
        <Check size={14} className="text-green-11" aria-hidden="true" />
        {signoff.signedBy?.name ?? "Someone"}
      </span>
      <span className="block text-xs font-normal text-muted-foreground">
        {formatDate(signoff.signedAt)}
        {signoff.signatureDeclined ? " · signed without a signature" : ""}
      </span>
    </>
  ) : (
    <span className="font-normal text-muted-foreground">{waiting}</span>
  );
  return (
    <div data-testid={`ipas-signoff-${section}-${role}`}>
      <DetailGrid items={[{ label: IPAS_SIGNOFF_ROLE_LABELS[role], value }]} />
    </div>
  );
}

/**
 * A section's sign-offs (#247), at the foot of section 1 and of section 3:
 * Prepared and Approved with who gave them, and the history of what was cleared
 * and why. The moves live in the decision card and the drawer's footer
 * (record/moves.js), so this body only reads; in the edit view it says where
 * they are when the viewer may give one.
 *
 *   state      ipas.signoffSections[section]
 *   rights     signoffRights(...) for the signed-in person
 */
export function IpasSignoffs({ section, state, rights }) {
  const badge = STATUS_BADGE[state.status];
  const hint = state.status === SIGNOFF_STATUS.AWAITING_APPROVAL ? WHY_NOT[rights.whyNotApprove] : null;
  // In the drawer the pinned footer carries the moves, so the body only reads.
  const inDrawer = useInDrawer();
  const mayGive = rights.canPrepare || rights.canApprove || rights.canSendBack;

  return (
    <div className="mt-5 space-y-3" data-testid={`ipas-signoffs-${section}`}>
      <SectionHeader title="Sign-offs" className="border-b-0 pb-2">
        <StatusBadge status={state.status} label={badge.label} />
      </SectionHeader>
      {!inDrawer && mayGive && <p className="text-xs text-muted-foreground">Sign-offs are in Your move.</p>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SignoffBox
          section={section}
          role={IPAS_SIGNOFF_ROLE.PREPARED}
          signoff={state.prepared}
          waiting="Purchasing submits it when it is ready for approval."
        />
        <SignoffBox
          section={section}
          role={IPAS_SIGNOFF_ROLE.APPROVED}
          signoff={state.approved}
          waiting={state.prepared ? "Waiting for an approver on the list." : "After it is submitted."}
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
