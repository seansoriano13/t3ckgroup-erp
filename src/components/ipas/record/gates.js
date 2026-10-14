// The six gates of an IPAS, in the order they happen, and which one is Now.
// Pure: `gatesFor` takes the digest and runs once in `digestIpas`, so the chain,
// the card and the section rows all read the same answer.

import {
  IPAS_COMPUTATION_STATUS,
  IPAS_COMPUTATION_STATUS_LABELS,
  IPAS_PART_NAMES,
  IPAS_PART_NO,
  IPAS_SIGNOFF_ROLE,
  IPAS_SIGNOFF_ROLE_LABELS,
  ipasSectionLabel,
} from "@/constants/ipas";
import { formatDate } from "@/utils/formatDate.js";
import { STATE, STATE_WORD } from "./statePalette";

const name = (signoff) => signoff?.signedBy?.name ?? "someone";
const APPROVED = IPAS_SIGNOFF_ROLE_LABELS[IPAS_SIGNOFF_ROLE.APPROVED];

/** Who the Noted and Checked gate waits on, while one of them is still open. */
function waitingOnNoteOrCheck(s7) {
  if (!s7.noted && !s7.checked) return "whoever notes or checks it";
  return s7.noted ? "whoever checks it" : "whoever notes it";
}

/**
 * The gate definitions, from the digest. `prereqMet` says whether the gate can
 * be passed yet; `moveKeys` are the moves (moves.js) that pass it.
 */
function gateDefs(digest) {
  const { s1, s3, s7, costsComplete, computationStatus } = digest;
  const sectionsApproved = Boolean(s1.approved && s3.approved);
  const noteAndCheck = Boolean(s7.noted && s7.checked);

  const section = (part, state, moveKeys) => ({
    key: part,
    part,
    role: APPROVED,
    done: Boolean(state.approved),
    prereqMet: true,
    waitsOn: state.prepared ? `the approvers of ${ipasSectionLabel(part)}` : "Purchasing",
    line: state.approved
      ? `Approved by ${name(state.approved)}`
      : state.prepared
        ? `Prepared by ${name(state.prepared)}, waiting for an approver`
        : "Waiting for Purchasing to prepare it",
    at: state.approved?.signedAt ?? null,
    moveKeys,
  });

  return [
    section("purchasing", s1, ["prepare-1", "approve-1"]),
    section("finance", s3, ["prepare-3", "approve-3"]),
    {
      key: "costs",
      part: "costing",
      role: "Costs complete",
      done: Boolean(costsComplete),
      // Its turn is once the computation status reaches Encoded.
      prereqMet: computationStatus === IPAS_COMPUTATION_STATUS.ENCODED,
      waitsOn: "Purchasing",
      line: `Computation status: ${IPAS_COMPUTATION_STATUS_LABELS[computationStatus] ?? "not set"}`,
      at: null,
      moveKeys: ["costs"],
    },
    {
      key: "received",
      part: "filing",
      role: IPAS_SIGNOFF_ROLE_LABELS[IPAS_SIGNOFF_ROLE.RECEIVED],
      done: Boolean(s7.received),
      prereqMet: sectionsApproved,
      waitsOn: "Finance",
      line: s7.received
        ? `Received by ${name(s7.received)}`
        : sectionsApproved
          ? "Waiting for Finance to receive it"
          : `Opens once ${ipasSectionLabel("purchasing")} and ${ipasSectionLabel("finance")} are approved`,
      at: s7.received?.signedAt ?? null,
      moveKeys: ["receive"],
    },
    {
      key: "noted-checked",
      part: "filing",
      role: "Noted and Checked",
      done: noteAndCheck,
      prereqMet: Boolean(s7.received),
      waitsOn: waitingOnNoteOrCheck(s7),
      line: noteAndCheck
        ? `${name(s7.noted)} and ${name(s7.checked)}`
        : s7.noted
          ? `Noted by ${name(s7.noted)}, Checked still open`
          : s7.checked
            ? `Checked by ${name(s7.checked)}, Noted still open`
            : s7.received
              ? "Noted and Checked, in either order"
              : "Noted and Checked, in either order, after Received",
      at: noteAndCheck ? (s7.checked.signedAt ?? null) : null,
      moveKeys: ["note", "check"],
    },
    {
      key: "approved",
      part: "filing",
      role: APPROVED,
      done: Boolean(s7.approved),
      prereqMet: noteAndCheck && Boolean(costsComplete),
      waitsOn: "the filing approvers",
      line: s7.approved ? `Approved by ${name(s7.approved)}` : "Files the IPAS, after Noted, Checked and Costs complete",
      at: s7.approved?.signedAt ?? null,
      moveKeys: ["file"],
    },
  ];
}

/**
 * The six gates in order, each with its state and flags:
 *   now       exactly one gate is Now while the IPAS is open: the first unmet
 *             gate whose prerequisites are met (if none is, the first unmet one)
 *   eligible  not done, and its prerequisites are met (or it is Now)
 *   state     "done" | "current" (Now) | "waiting"
 *   accessibleName  "Section 2, Purchasing & Finance, Approved, waiting"
 * A filed or cancelled IPAS has no gate Now.
 */
export function gatesFor(digest) {
  const defs = gateDefs(digest);
  const unmet = defs.filter((gate) => !gate.done);
  const now = digest.open ? (unmet.find((gate) => gate.prereqMet) ?? unmet[0] ?? null) : null;

  return defs.map((gate) => {
    const isNow = gate === now;
    const state = gate.done ? STATE.DONE : isNow ? STATE.CURRENT : STATE.WAITING;
    const when = gate.at ? formatDate(gate.at) : null;
    return {
      ...gate,
      no: IPAS_PART_NO[gate.part],
      label: ipasSectionLabel(gate.part),
      sectionName: IPAS_PART_NAMES[gate.part],
      now: isNow,
      eligible: !gate.done && (gate.prereqMet || isNow),
      state,
      line: when ? `${gate.line} · ${when}` : gate.line,
      accessibleName: `Section ${IPAS_PART_NO[gate.part]}, ${IPAS_PART_NAMES[gate.part]}, ${gate.role}, ${STATE_WORD[state].toLowerCase()}`,
    };
  });
}

/** The gate that is Now, or null. */
export function nowGate(gates) {
  return gates.find((gate) => gate.now) ?? null;
}

/** The sections waited on now, named and joined: "1 · Purchasing and 2 · Purchasing & Finance". */
export function waitingSections(gates) {
  const labels = [...new Set(gates.filter((gate) => gate.eligible && !gate.done).map((gate) => gate.label))];
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
}
