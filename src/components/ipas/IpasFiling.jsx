import { Check, Circle, CornerUpLeft, FileCheck2 } from "lucide-react";

import { Button } from "../ui/button";
import SectionHeader from "../ui/SectionHeader";
import StatusBadge from "../StatusBadge";
import { IpasSection } from "./IpasSections";
import { SignoffBox } from "./IpasSignoffs";
import {
  IPAS_COMPUTATION_STATUS_LABELS,
  IPAS_SECTION_7_ROLES,
  IPAS_SIGNOFF_ROLE,
  IPAS_SIGNOFF_ROLE_ACTIONS,
  IPAS_SIGNOFF_ROLE_LABELS,
  IPAS_STATE,
} from "../../constants/ipas";
import { filingChecklist } from "../../utils/ipasDocuments";
import { FILING_STATUS, isCostsComplete } from "../../utils/ipasSignoffs";
import { formatDate } from "../../utils/formatDate.js";

const STATUS_BADGE = {
  [FILING_STATUS.WAITING]: { theme: "mauve", label: "Waiting for sections 1 and 3" },
  [FILING_STATUS.READY]: { theme: "amber", label: "Ready to receive" },
  [FILING_STATUS.IN_PROGRESS]: { theme: "amber", label: "In progress" },
  [FILING_STATUS.FILED]: { theme: "green", label: "Filed" },
};

/** What each box says while it is empty, from where section 7 stands. */
function waitingText(role, state) {
  if (!state.opened) return "Opens once sections 1 and 3 are approved.";
  if (role === IPAS_SIGNOFF_ROLE.RECEIVED) return "Comes first.";
  if (!state.received) return "After Received.";
  if (role === IPAS_SIGNOFF_ROLE.APPROVED) {
    return state.noted && state.checked ? "Files the IPAS." : "After Noted and Checked.";
  }
  return "Waiting for someone on the list.";
}

const WHY_NOT = {
  costs_incomplete:
    "Approved files the IPAS and freezes Landed Cost, so it waits for the computation status to reach Costs complete.",
};

/**
 * Section 7 (#248): the filing checklist and the four sign-offs, Received
 * first, then Noted and Checked in either order, then Approved, which files the
 * IPAS and locks it. The checklist reads the same documents as section 3, so a
 * Waybill ticked there is already ticked here.
 *
 *   rights     section7Rights(...) for the signed-in person
 *   onGive     (role) => void; the page owns the mutation (and the filing dialog)
 *   canSendBack / onSendBack
 *              a section 7 signer returns Received, Noted and Checked with a
 *              reason (canSendBackSection7); the page owns the dialog
 */
export function IpasFilingSection({ ipas, rights, busy = false, onGive, canSendBack = false, onSendBack }) {
  const state = ipas.signoffSections[7];
  const badge = STATUS_BADGE[state.status];
  const checklist = filingChecklist(ipas.documents ?? []);
  const costsComplete = isCostsComplete(ipas.computationStatus);
  const filed = ipas.state === IPAS_STATE.FILED;
  const offered = IPAS_SECTION_7_ROLES.filter((role) => rights[role]?.canGive);
  const hint = rights[IPAS_SIGNOFF_ROLE.APPROVED]?.why === "costs_incomplete" ? WHY_NOT.costs_incomplete : null;

  return (
    <IpasSection
      title="7 · Filing"
      aside={<StatusBadge theme={badge.theme} label={badge.label} />}
    >
      <div className="space-y-4" data-testid="ipas-filing">
        <div>
          <SectionHeader title="Checklist" className="pb-2" />
          <ul className="mt-1 divide-y divide-border">
            <ChecklistItem
              ticked={costsComplete}
              label="Costs complete"
              detail={`Computation status: ${IPAS_COMPUTATION_STATUS_LABELS[ipas.computationStatus] ?? "—"}`}
            />
            {checklist.length === 0 ? (
              <li className="py-2 text-[13px] text-muted-foreground">
                No filing items are listed for this IPAS. Documents are ticked in section 3.
              </li>
            ) : (
              checklist.map((doc) => (
                <ChecklistItem
                  key={doc.id}
                  ticked={doc.ticked}
                  label={doc.label}
                  detail={
                    doc.purchasingHas && doc.financeHas
                      ? "Purchasing and Finance have it"
                      : doc.purchasingHas
                        ? "Purchasing has it"
                        : doc.financeHas
                          ? "Finance has it"
                          : "Not ticked"
                  }
                />
              ))
            )}
          </ul>
          <p className="mt-1 text-xs text-muted-foreground">
            Missing documents only warn: Approved lists them and goes ahead on confirm. Costs complete is required.
          </p>
        </div>

        <div className="space-y-3">
          <SectionHeader title="Sign-offs" className="pb-2">
            {offered.map((role) => (
              <Button
                key={role}
                size="sm"
                className="gap-1.5"
                disabled={busy}
                onClick={() => onGive(role)}
                data-testid={`ipas-give-${role}`}
              >
                {role === IPAS_SIGNOFF_ROLE.APPROVED ? <FileCheck2 size={14} /> : <Check size={14} />}
                {role === IPAS_SIGNOFF_ROLE.APPROVED
                  ? "Approve and file"
                  : `${IPAS_SIGNOFF_ROLE_ACTIONS[role]} (${IPAS_SIGNOFF_ROLE_LABELS[role]})`}
              </Button>
            ))}
            {canSendBack && (
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                disabled={busy}
                onClick={onSendBack}
                data-testid="ipas-send-back-7"
              >
                <CornerUpLeft size={14} />
                Send back
              </Button>
            )}
          </SectionHeader>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {IPAS_SECTION_7_ROLES.map((role) => (
              <SignoffBox
                key={role}
                section={7}
                role={role}
                signoff={state[role]}
                waiting={waitingText(role, state)}
              />
            ))}
          </div>

          {hint && state.noted && state.checked && !filed && (
            <p className="text-xs text-muted-foreground">{hint}</p>
          )}
        </div>

        {state.history.length > 0 && (
          <div className="space-y-1" data-testid="ipas-signoff-history-7">
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
    </IpasSection>
  );
}

function ChecklistItem({ ticked, label, detail }) {
  return (
    <li className="flex items-center gap-2 py-2 text-[13px]" data-testid="ipas-filing-item" data-ticked={ticked}>
      {ticked ? (
        <Check size={15} className="shrink-0 text-green-11" aria-label="Ticked" />
      ) : (
        <Circle size={15} className="shrink-0 text-muted-foreground" aria-label="Not ticked" />
      )}
      <span className={ticked ? "font-medium text-foreground" : "text-foreground"}>{label}</span>
      <span className="ml-auto text-xs text-muted-foreground">{detail}</span>
    </li>
  );
}

/**
 * What the top of the page says about a filed IPAS: when it was filed and what
 * that means, with the Super Admin's way back.
 */
export function IpasFiledNotice({ ipas, canReopen, onReopen }) {
  if (ipas.state !== IPAS_STATE.FILED) return null;
  const approved = ipas.signoffSections?.[7]?.approved ?? null;
  return (
    <div
      role="status"
      data-testid="ipas-filed-notice"
      className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-green-400 bg-green-3/40 p-3 text-[13px]"
    >
      <div>
        <p className="font-semibold text-green-11">
          Filed {formatDate(ipas.filed_at)}
          {approved?.signedBy?.name ? ` · approved by ${approved.signedBy.name}` : ""}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          This IPAS is frozen: its Odoo copy, payments, charges, documents, bank details, SORs, Purpose and Landed
          Cost no longer change. A Super Admin can reopen it with a reason.
        </p>
      </div>
      {canReopen && (
        <Button size="sm" variant="outline" onClick={onReopen}>
          Reopen
        </Button>
      )}
    </div>
  );
}
