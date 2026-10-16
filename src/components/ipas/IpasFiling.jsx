import { Check, Circle } from "lucide-react";

import { Button } from "../ui/button";
import SectionHeader from "../ui/SectionHeader";
import StatusBadge from "../StatusBadge";
import { IpasSection } from "./IpasSections";
import { SignoffBox } from "./IpasSignoffs";
import {
  IPAS_COMPUTATION_STATUS_LABELS,
  IPAS_SECTION_7_ROLES,
  IPAS_SIGNOFF_ROLE,
  IPAS_SIGNOFF_ROLE_LABELS,
  IPAS_STATE,
  ipasSectionLabel,
} from "../../constants/ipas";
import { filingChecklist } from "../../utils/ipasDocuments";
import { FILING_STATUS, isLandedCostFinal } from "../../utils/ipasSignoffs";
import { formatDate } from "../../utils/formatDate.js";
import { useInDrawer } from "@/components/record/sectionChrome";

/** The two sign-off sections that open section 7, as a person reads them. */
const OPENING_SECTIONS = `${ipasSectionLabel("purchasing")} and ${ipasSectionLabel("finance")}`;

const STATUS_BADGE = {
  [FILING_STATUS.WAITING]: { label: `Waiting for ${OPENING_SECTIONS}` },
  [FILING_STATUS.READY]: { label: "Ready to receive" },
  [FILING_STATUS.IN_PROGRESS]: { label: "In progress" },
  [FILING_STATUS.FILED]: { label: "Filed" },
};

/** What each box says while it is empty, from where section 7 stands. */
function waitingText(role, state) {
  if (!state.opened) return `Opens once ${OPENING_SECTIONS} are approved.`;
  if (role === IPAS_SIGNOFF_ROLE.RECEIVED) return "Comes first.";
  if (!state.received) return "After Received.";
  if (role === IPAS_SIGNOFF_ROLE.APPROVED) {
    return state.noted && state.checked ? "Files the IPAS." : "After Noted and Checked.";
  }
  return "Waiting for someone on the list.";
}

const WHY_NOT = {
  costs_incomplete:
    "Approved files the IPAS and freezes Landed Cost, so it waits for the computation status to reach LC Odoo Done.",
};

/**
 * Section 7 (#248): the filing checklist and the four sign-offs, Received
 * first, then Noted and Checked in either order, then Approved, which files the
 * IPAS and locks it. The checklist reads the same documents as section 3, so a
 * Waybill ticked there is already ticked here.
 *
 *   rights     section7Rights(...) for the signed-in person
 *   canSendBack
 *              a section 7 signer may return Received, Noted and Checked
 *              (canSendBackSection7). The moves live in the decision card and
 *              the drawer's footer, so the body only reads.
 */
export function IpasFilingSection({ ipas, rights, canSendBack = false }) {
  const state = ipas.signoffSections[7];
  const badge = STATUS_BADGE[state.status];
  const checklist = filingChecklist(ipas.documents ?? []);
  const costsComplete = isLandedCostFinal(ipas.computationStatus);
  const filed = ipas.state === IPAS_STATE.FILED;
  const offered = IPAS_SECTION_7_ROLES.filter((role) => rights[role]?.canGive);
  const hint = rights[IPAS_SIGNOFF_ROLE.APPROVED]?.why === "costs_incomplete" ? WHY_NOT.costs_incomplete : null;
  // In the drawer the pinned footer carries the give and send-back moves, so the body only reads.
  const inDrawer = useInDrawer();

  return (
    <IpasSection
      title={ipasSectionLabel("filing")}
      aside={<StatusBadge status={state.status} label={badge.label} />}
    >
      <div className="space-y-4" data-testid="ipas-filing">
        <div>
          <SectionHeader title="Checklist" className="border-b-0 pb-2" />
          <ul className="mt-1 divide-y divide-border">
            <ChecklistItem
              ticked={costsComplete}
              label="LC Odoo Done"
              detail={`Computation status: ${IPAS_COMPUTATION_STATUS_LABELS[ipas.computationStatus] ?? "—"}`}
            />
            {checklist.length === 0 ? (
              <li className="py-2 text-sm text-muted-foreground">
                No filing items are listed for this IPAS. Documents are ticked in section {ipasSectionLabel("finance")}.
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
            Missing documents only warn: Approved lists them and goes ahead on confirm. LC Odoo Done is required.
          </p>
        </div>

        <div className="space-y-3">
          <SectionHeader title="Sign-offs" className="border-b-0 pb-2" />
          {!inDrawer && (offered.length > 0 || canSendBack) && (
            <p className="text-xs text-muted-foreground">Sign-offs are in Your move.</p>
          )}

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
    <li className="flex items-center gap-2 py-2 text-sm" data-testid="ipas-filing-item" data-ticked={ticked}>
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
      className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-green-7 bg-green-3/40 p-3 text-sm"
    >
      <div>
        <p className="font-semibold text-green-11">
          Filed {formatDate(ipas.filed_at)}
          {approved?.signedBy?.name ? ` · approved by ${approved.signedBy.name}` : ""}
        </p>
        <p className="mt-0.5 max-w-prose text-xs text-mauve-11">
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
