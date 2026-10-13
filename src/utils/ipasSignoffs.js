/**
 * Pure helpers for the IPAS sign-offs (#247, spec #241). No network, no React.
 *
 * A sign-off is a row of `ipas_signoffs`: a section, a role and who gave it. The
 * live one is the row that isn't cleared; a cleared row is kept as history.
 * What a person may do is the database's call (ipas_sign, ipas_send_back); the
 * helpers here only work out what the screen should offer so nobody is shown a
 * button the database will refuse.
 */

import {
  IPAS_APPROVAL_LIST,
  IPAS_COMPUTATION_STATUS,
  IPAS_SECTION_7_ROLES,
  IPAS_SIGNER_LIST,
  IPAS_SIGNOFF_ROLE,
  IPAS_STATE,
} from "../constants/ipas";

export const SIGNOFF_STATUS = {
  NOT_PREPARED: "not_prepared",
  AWAITING_APPROVAL: "awaiting_approval",
  APPROVED: "approved",
};

const person = (embed, id) => (embed ? { id: embed.id ?? id, name: embed.name ?? null, avatarPath: embed.avatar_path ?? null } : id ? { id, name: null, avatarPath: null } : null);

/** An `ipas_signoffs` row (with its `signer` and `clearer` employee embeds) as the screens read it. */
export function shapeSignoff(row) {
  return {
    id: row.id,
    ipasId: row.ipas_id,
    section: Number(row.section),
    role: row.role,
    signedBy: person(row.signer, row.signed_by),
    signedAt: row.signed_at ?? null,
    signatureDeclined: Boolean(row.signature_declined),
    signatureVersion: row.signature_version ?? null,
    clearedAt: row.cleared_at ?? null,
    clearedReason: row.cleared_reason ?? null,
    clearedBy: person(row.clearer, row.cleared_by),
  };
}

/** Every sign-off of an IPAS, oldest first. */
export function shapeSignoffs(rows = []) {
  return rows
    .map(shapeSignoff)
    .sort((a, b) => String(a.signedAt).localeCompare(String(b.signedAt)));
}

/**
 * One section's sign-offs from the shaped list: the live Prepared and Approved,
 * where the section stands, and the cleared ones newest first.
 */
export function sectionSignoffs(signoffs = [], section) {
  const here = signoffs.filter((s) => s.section === section);
  const live = (role) => here.find((s) => s.role === role && !s.clearedAt) ?? null;
  const prepared = live(IPAS_SIGNOFF_ROLE.PREPARED);
  const approved = live(IPAS_SIGNOFF_ROLE.APPROVED);
  const status = approved
    ? SIGNOFF_STATUS.APPROVED
    : prepared
      ? SIGNOFF_STATUS.AWAITING_APPROVAL
      : SIGNOFF_STATUS.NOT_PREPARED;
  const history = here
    .filter((s) => s.clearedAt)
    .sort((a, b) => String(b.clearedAt).localeCompare(String(a.clearedAt)));
  return { section, prepared, approved, status, history };
}

/**
 * What the signed-in person can do on a section, from where it stands.
 *
 *   canPrepare    Purchasing access, an open IPAS, nothing prepared yet
 *   canApprove    on the section's approval list, prepared, not approved, and
 *                 not the preparer; a Super Admin is on the list or not like
 *                 anyone else
 *   canSendBack   on the section's approval list, with something signed to return
 *   whyNotApprove "preparer" | "not_prepared" | "approved" | "not_on_list" | null
 *
 * `lists` is `ipasService.getSignerLists()`; a missing list reads as nobody.
 */
export function signoffRights({ section, sectionState, userId, hasPurchasingFlow = false, lists = {}, ipasState }) {
  const open = ipasState === IPAS_STATE.OPEN;
  const listKey = IPAS_APPROVAL_LIST[section];
  const onList = Boolean(userId) && (lists?.[listKey] ?? []).some((member) => member.employeeId === userId);
  const { prepared, approved } = sectionState;

  let whyNotApprove = null;
  if (approved) whyNotApprove = "approved";
  else if (!prepared) whyNotApprove = "not_prepared";
  else if (!onList) whyNotApprove = "not_on_list";
  else if (prepared.signedBy?.id === userId) whyNotApprove = "preparer";

  return {
    open,
    onList,
    canPrepare: open && hasPurchasingFlow && !prepared,
    canApprove: open && whyNotApprove === null,
    canSendBack: open && onList && Boolean(prepared || approved),
    whyNotApprove,
  };
}

// ── Section 7 and Filing (#248) ─────────────────────────────────────────────

export const FILING_STATUS = {
  /** Sections 1 and 3 aren't both approved yet, so section 7 hasn't opened. */
  WAITING: "waiting",
  /** Open for Received. */
  READY: "ready",
  IN_PROGRESS: "in_progress",
  FILED: "filed",
};

const SECTION_7 = 7;

/**
 * Section 7's state from the shaped sign-offs: the live Received, Noted,
 * Checked and Approved, whether it has opened (sections 1 and 3 both approved),
 * where it stands, and the cleared ones newest first (a reopening clears the
 * lot, and the history says why).
 *
 * `next` is the roles that can be given now, in the sheet's order: Received
 * first; Noted and Checked after it, in either order; Approved after all three.
 */
export function section7Signoffs(signoffs = []) {
  const live = (section, role) => signoffs.find((s) => s.section === section && s.role === role && !s.clearedAt) ?? null;
  const received = live(SECTION_7, IPAS_SIGNOFF_ROLE.RECEIVED);
  const noted = live(SECTION_7, IPAS_SIGNOFF_ROLE.NOTED);
  const checked = live(SECTION_7, IPAS_SIGNOFF_ROLE.CHECKED);
  const approved = live(SECTION_7, IPAS_SIGNOFF_ROLE.APPROVED);
  const opened = Boolean(live(1, IPAS_SIGNOFF_ROLE.APPROVED) && live(3, IPAS_SIGNOFF_ROLE.APPROVED));

  const next = [];
  if (opened && !approved) {
    if (!received) next.push(IPAS_SIGNOFF_ROLE.RECEIVED);
    else {
      if (!noted) next.push(IPAS_SIGNOFF_ROLE.NOTED);
      if (!checked) next.push(IPAS_SIGNOFF_ROLE.CHECKED);
      if (noted && checked) next.push(IPAS_SIGNOFF_ROLE.APPROVED);
    }
  }

  const status = approved
    ? FILING_STATUS.FILED
    : !opened
      ? FILING_STATUS.WAITING
      : received
        ? FILING_STATUS.IN_PROGRESS
        : FILING_STATUS.READY;

  const history = signoffs
    .filter((s) => s.section === SECTION_7 && s.clearedAt)
    .sort((a, b) => String(b.clearedAt).localeCompare(String(a.clearedAt)));

  return { section: SECTION_7, received, noted, checked, approved, opened, next, status, history };
}

/**
 * What the signed-in person can do in section 7, per role, from where it
 * stands: `{ [role]: { canGive, why } }`. `why` is the first thing in the way:
 * "given" | "not_open" (IPAS filed or cancelled) | "sections_not_approved" |
 * "not_on_list" | "needs_received" | "needs_all_three" | "costs_incomplete",
 * or null. The database decides and refuses anything else; this spares people a
 * button that would fail and says why.
 *
 * `lists` is `ipasService.getSignerLists()`. `costsComplete` is whether the
 * computation status is Costs complete or later.
 */
export function section7Rights({ state, userId, lists = {}, ipasState, costsComplete = false }) {
  const open = ipasState === IPAS_STATE.OPEN;
  const onList = (listKey) => Boolean(userId) && (lists?.[listKey] ?? []).some((member) => member.employeeId === userId);
  const out = {};
  for (const role of IPAS_SECTION_7_ROLES) {
    let why = null;
    if (state[role]) why = "given";
    else if (!open) why = "not_open";
    else if (!state.opened) why = "sections_not_approved";
    else if (role !== IPAS_SIGNOFF_ROLE.RECEIVED && !state.received) why = "needs_received";
    else if (role === IPAS_SIGNOFF_ROLE.APPROVED && !(state.noted && state.checked)) why = "needs_all_three";
    else if (!onList(SECTION_7_LIST[role])) why = "not_on_list";
    else if (role === IPAS_SIGNOFF_ROLE.APPROVED && !costsComplete) why = "costs_incomplete";
    out[role] = { canGive: why === null, why };
  }
  return out;
}

const SECTION_7_LIST = {
  [IPAS_SIGNOFF_ROLE.RECEIVED]: IPAS_SIGNER_LIST.S7_RECEIVED,
  [IPAS_SIGNOFF_ROLE.NOTED]: IPAS_SIGNER_LIST.S7_NOTED,
  [IPAS_SIGNOFF_ROLE.CHECKED]: IPAS_SIGNER_LIST.S7_CHECKED,
  [IPAS_SIGNOFF_ROLE.APPROVED]: IPAS_SIGNER_LIST.S7_APPROVED,
};

/** Whether a computation status is Costs complete or later (what Filing needs). */
export function isCostsComplete(status) {
  return status === IPAS_COMPUTATION_STATUS.COSTS_COMPLETE || status === IPAS_COMPUTATION_STATUS.CHECKED;
}
