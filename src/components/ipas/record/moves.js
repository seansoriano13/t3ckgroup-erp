import { Check, CornerUpLeft, FileCheck2, PenLine, RotateCcw } from "lucide-react";

import {
  IPAS_COMPUTATION_STATUS,
  IPAS_SECTION_7_ROLES,
  IPAS_SIGNOFF_ROLE,
  IPAS_SIGNOFF_ROLE_ACTIONS,
  IPAS_SIGNOFF_ROLE_LABELS,
  ipasSectionLabel,
} from "@/constants/ipas";

/**
 * Everything the signed-in person may do on this IPAS right now, most pressing
 * first. Returns `{ moves, returns }`: the moves are the sign-offs and the
 * computation status; the returns are the send-backs (shown apart, in red).
 */
export function movesFor(ctx, digest) {
  const { rights, can, on } = ctx;
  const moves = [];
  for (const section of [1, 3]) {
    const mine = rights[section];
    const label = ipasSectionLabel(section);
    if (mine.canApprove) {
      moves.push({ key: `a${section}`, kind: "approve", icon: Check, label: `Approve ${label}`, run: () => on.approve(section) });
    }
    if (mine.canPrepare) {
      moves.push({ key: `p${section}`, kind: "primary", icon: PenLine, label: `Prepare ${label}`, run: () => on.prepare(section) });
    }
  }
  for (const role of IPAS_SECTION_7_ROLES) {
    if (!rights[7][role]?.canGive) continue;
    const files = role === IPAS_SIGNOFF_ROLE.APPROVED;
    moves.push({
      key: `g${role}`,
      kind: "approve",
      icon: files ? FileCheck2 : Check,
      label: files ? "Approve and file" : `${IPAS_SIGNOFF_ROLE_ACTIONS[role]} (${IPAS_SIGNOFF_ROLE_LABELS[role]})`,
      run: () => on.give(role),
    });
  }
  if (can.change && !digest.costsComplete) {
    moves.push({
      key: "costs",
      kind: "outline",
      icon: Check,
      label: "Mark costs complete",
      run: () => on.setComputationStatus(IPAS_COMPUTATION_STATUS.COSTS_COMPLETE),
    });
  }
  const returns = [];
  for (const section of [1, 3]) {
    if (rights[section].canSendBack) {
      returns.push({ key: `b${section}`, icon: CornerUpLeft, label: `Send ${ipasSectionLabel(section)} back`, run: () => on.sendBack(section) });
    }
  }
  if (rights.sendBack7) {
    returns.push({ key: "b7", icon: CornerUpLeft, label: `Send ${ipasSectionLabel(7)} back`, run: () => on.sendBack(7) });
  }
  if (can.reopen) {
    moves.push({ key: "reopen", kind: "outline", icon: RotateCcw, label: "Reopen this IPAS", run: on.reopen });
  }
  return { moves, returns };
}
