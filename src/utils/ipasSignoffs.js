/**
 * Pure helpers for the IPAS sign-offs (#247, spec #241). No network, no React.
 *
 * A sign-off is a row of `ipas_signoffs`: a section, a role and who gave it. The
 * live one is the row that isn't cleared; a cleared row is kept as history.
 * What a person may do is the database's call (ipas_sign, ipas_send_back); the
 * helpers here only work out what the screen should offer so nobody is shown a
 * button the database will refuse.
 */

import { IPAS_APPROVAL_LIST, IPAS_SIGNOFF_ROLE, IPAS_STATE } from "../constants/ipas";

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
