// What a Transmittal record page reads, pure: who may do what, the chain of
// steps and which one is Now, the section rows with their state and summary,
// and the numbers strip. The database holds the rules; this only decides what
// the screen offers and says, so nothing is shown that it would refuse.

import {
  TRANSMITTAL_LINE_KIND,
  TRANSMITTAL_RATING,
  TRANSMITTAL_STAFF_LIST as LIST,
  TRANSMITTAL_STAGE as STAGE,
  TRANSMITTAL_STATE as STATE,
} from "@/constants/transmittals";
import { STATE as GATE_STATE, STATE_WORD } from "@/components/record/statePalette";
import { formatDate } from "@/utils/formatDate.js";
import { formatPreparedAt } from "@/utils/preparedAt";
import { stageRowOf, stagesOf, transmittalStateLabel } from "@/utils/transmittals";

export const STAGE_TITLE = {
  [STAGE.WAREHOUSE_CHECKING]: "Warehouse checking",
  [STAGE.WAREHOUSE_RELEASING]: "Warehouse releasing",
  [STAGE.TECHNICAL_INSPECTION]: "Technical inspection",
};

/** The two signatories' captions on each stage, as on the paper form. */
export const STAGE_SIGNERS = {
  [STAGE.WAREHOUSE_CHECKING]: { first: "Received by", second: "Inspected by" },
  [STAGE.WAREHOUSE_RELEASING]: { first: "Released by", second: "Received by" },
  [STAGE.TECHNICAL_INSPECTION]: { first: "Received by", second: "Inspected by" },
};

/** The row keys that are not a stage. A stage's row key is its stage name. */
export const SECTION = {
  DETAILS: "details",
  LINES: "lines",
  ODOO: "odoo",
  CHECK_BY: "check_by",
};

const ENDED = [STATE.CLOSED, STATE.CANCELLED];

/** The order stages are signed in; a stage is undone only while no later one is signed. */
const STAGE_ORDER = {
  [STAGE.WAREHOUSE_CHECKING]: 1,
  [STAGE.WAREHOUSE_RELEASING]: 2,
  [STAGE.TECHNICAL_INSPECTION]: 3,
};

/** Who a stage waits on, for the card's status line. */
const STAGE_WAITS_ON = {
  [STAGE.WAREHOUSE_CHECKING]: "the Warehouse",
  [STAGE.WAREHOUSE_RELEASING]: "the Warehouse",
  [STAGE.TECHNICAL_INSPECTION]: "Technical",
};

/** The slip state while each stage is the one being worked. */
const OPEN_STATE = {
  [STAGE.WAREHOUSE_CHECKING]: STATE.WAREHOUSE_CHECKING,
  [STAGE.WAREHOUSE_RELEASING]: STATE.WAREHOUSE_RELEASING,
  [STAGE.TECHNICAL_INSPECTION]: STATE.TECHNICAL_INSPECTION,
};

/** True when the slip carries a PO line, which Check by waits on Received in Odoo for. */
export function hasPoLine(t) {
  return t.lines.some((line) => line.kind === TRANSMITTAL_LINE_KIND.PO_LINE);
}

/**
 * What the signed-in person may do on this slip right now, as the database
 * decides it (the staff lists and the preparer or Purchasing access).
 * @param {object} t  a shaped Transmittal
 * @param {{ userId?: string, lists?: string[], hasPurchasingFlow?: boolean }} viewer
 */
export function rightsOf(t, { userId = null, lists = [], hasPurchasingFlow = false } = {}) {
  const draft = t.state === STATE.DRAFT;
  const ended = ENDED.includes(t.state);
  const open = !ended && !draft;
  const onWarehouse = lists.includes(LIST.WAREHOUSE);
  const onTechnical = lists.includes(LIST.TECHNICAL);
  const onCheckBy = lists.includes(LIST.CHECK_BY);
  const { first, second } = t.checkBy;
  const awaiting = t.state === STATE.AWAITING_CHECK;
  // A slip carrying a PO line is checked only once Received in Odoo is signed.
  const needsReceipt = !t.odooReceivedAt && hasPoLine(t);
  // The preparer never signs Check by on their own slip.
  const notPreparer = t.preparedById !== userId;
  const mayTakeFirst = onCheckBy && notPreparer && awaiting && !first && second?.id !== userId;
  const mayTakeSecond = onCheckBy && notPreparer && awaiting && !second && first?.id !== userId;

  // The co-signer holds the slot still waiting: the second, or the first when the completer signed second.
  const awaitingConfirm = (stage) => {
    const row = stageRowOf(t, stage);
    if (!userId || !row?.completed_at) return null;
    const slot =
      !row.second_confirmed && !row.second_signature_declined
        ? "second"
        : !row.first_confirmed && !row.first_signature_declined
          ? "first"
          : null;
    return slot && row[`${slot}_signer_id`] === userId ? slot : null;
  };

  const stageRow = (stage) => stageRowOf(t, stage);

  // Undo (#538): whoever may sign a step may undo it, latest step first, as the database holds it.
  const anyCheckBy = Boolean(first || second);
  const later = (stage) => t.stages.some((s) => s.completed_at && STAGE_ORDER[s.stage] > STAGE_ORDER[stage]);
  const undoStage = (stage) =>
    Boolean(stageRow(stage)?.completed_at) &&
    (stage === STAGE.TECHNICAL_INSPECTION ? onTechnical : onWarehouse) &&
    open &&
    !anyCheckBy &&
    !later(stage);
  const undoCheckBy = (slot) =>
    Boolean(slot) && onCheckBy && t.preparedById !== userId && t.state !== STATE.CANCELLED && t.state !== STATE.DRAFT;
  return {
    draft,
    ended,
    open,
    onWarehouse,
    onTechnical,
    onCheckBy,
    // The preparer or Purchasing access (a Super Admin alone is neither).
    canChange: t.preparedById === userId || hasPurchasingFlow,
    canCancel: !ended && !t.stages.some((s) => s.completed_at) && (t.preparedById === userId || hasPurchasingFlow),
    canRate: {
      [STAGE.WAREHOUSE_CHECKING]: onWarehouse && t.state === STATE.WAREHOUSE_CHECKING,
      [STAGE.TECHNICAL_INSPECTION]: onTechnical && t.state === STATE.TECHNICAL_INSPECTION,
    },
    // Releasing is signed in its state on a Warehouse + Technical slip; on a
    // Warehouse-only slip it is optional and signable until the slip closes.
    canSign: {
      [STAGE.WAREHOUSE_CHECKING]:
        onWarehouse && t.state === STATE.WAREHOUSE_CHECKING && Boolean(stageRow(STAGE.WAREHOUSE_CHECKING)),
      [STAGE.WAREHOUSE_RELEASING]: onWarehouse && (t.checkTechnical ? t.state === STATE.WAREHOUSE_RELEASING : open),
      [STAGE.TECHNICAL_INSPECTION]: onTechnical && t.state === STATE.TECHNICAL_INSPECTION,
    },
    awaitingConfirm,
    undo: {
      stage: {
        [STAGE.WAREHOUSE_CHECKING]: undoStage(STAGE.WAREHOUSE_CHECKING),
        [STAGE.WAREHOUSE_RELEASING]: undoStage(STAGE.WAREHOUSE_RELEASING),
        [STAGE.TECHNICAL_INSPECTION]: undoStage(STAGE.TECHNICAL_INSPECTION),
      },
      odoo: Boolean(t.odooReceivedAt) && (onWarehouse || hasPurchasingFlow) && open && !anyCheckBy,
      checkBy: { first: undoCheckBy(first), second: undoCheckBy(second) },
    },
    canRecordOdoo: (onWarehouse || hasPurchasingFlow) && open && !t.odooReceivedAt,
    needsReceipt,
    checkBy: { first: mayTakeFirst && !needsReceipt, second: mayTakeSecond && !needsReceipt },
    // Check by is open to the caller but waits on Received in Odoo.
    checkByBlocked: needsReceipt && (mayTakeFirst || mayTakeSecond),
  };
}

const isSigned = (t, stage) => Boolean(stageRowOf(t, stage)?.completed_at);

/** True for the optional Warehouse releasing of a Warehouse-only slip. */
function releasingIsOptional(t) {
  return t.checkWarehouse && !t.checkTechnical;
}

/**
 * The rows the slip shows, in order. A draft shows only what it has: its
 * details and lines. A submitted slip shows each stage its Checking boxes
 * ticked, Received in Odoo, and Check by.
 */
export function sectionsOf(t) {
  const sections = [
    { key: SECTION.DETAILS, title: "Details" },
    { key: SECTION.LINES, title: "Lines" },
  ];
  if (t.state === STATE.DRAFT) return sections;
  const stages = stagesOf(t);
  const open = !ENDED.includes(t.state);
  const showReleasing =
    stages.includes(STAGE.WAREHOUSE_RELEASING) || (releasingIsOptional(t) && (open || isSigned(t, STAGE.WAREHOUSE_RELEASING)));
  if (stages.includes(STAGE.WAREHOUSE_CHECKING)) {
    sections.push({ key: STAGE.WAREHOUSE_CHECKING, title: STAGE_TITLE[STAGE.WAREHOUSE_CHECKING] });
  }
  if (showReleasing) sections.push({ key: STAGE.WAREHOUSE_RELEASING, title: STAGE_TITLE[STAGE.WAREHOUSE_RELEASING] });
  if (stages.includes(STAGE.TECHNICAL_INSPECTION)) {
    sections.push({ key: STAGE.TECHNICAL_INSPECTION, title: STAGE_TITLE[STAGE.TECHNICAL_INSPECTION] });
  }
  if (t.checkWarehouse || t.stages.length > 0) sections.push({ key: SECTION.ODOO, title: "Received in Odoo" });
  sections.push({ key: SECTION.CHECK_BY, title: "Check by" });
  return sections;
}

const signerName = (row, slot) =>
  slot === "first" ? (row.first_signer?.name ?? "someone") : (row.second_signer?.name ?? row.second_signer_name ?? "someone");

/**
 * The chain of steps in order, each with its state ("done", "current" Now,
 * "waiting"): the slip's stages, Received in Odoo where the slip needs it, and
 * Check by. At most one is Now, and none on a draft or an ended slip.
 */
export function gatesOf(t) {
  const steps = [];
  for (const stage of stagesOf(t)) {
    const row = stageRowOf(t, stage);
    const done = Boolean(row?.completed_at);
    steps.push({
      key: stage,
      label: STAGE_TITLE[stage],
      role: stage === STAGE.TECHNICAL_INSPECTION ? "Technical" : "Warehouse",
      done,
      waitsOn: STAGE_WAITS_ON[stage],
      line: done
        ? `Signed by ${signerName(row, "first")} and ${signerName(row, "second")}`
        : `Waiting for ${STAGE_WAITS_ON[stage]}`,
      at: row?.completed_at ?? null,
    });
  }
  if (hasPoLine(t)) {
    steps.push({
      key: SECTION.ODOO,
      label: "Received in Odoo",
      role: "Warehouse or Purchasing",
      done: Boolean(t.odooReceivedAt),
      waitsOn: "the Warehouse or Purchasing",
      line: t.odooReceivedAt
        ? `Recorded by ${t.odooReceivedBy?.name ?? "someone"}`
        : "Waiting for the Warehouse or Purchasing",
      at: t.odooReceivedAt,
    });
  }
  const { first, second } = t.checkBy;
  const checked = Boolean(first && second);
  steps.push({
    key: SECTION.CHECK_BY,
    label: "Check by",
    role: "Check by list",
    done: checked,
    waitsOn: "the Check by list",
    line: checked
      ? `Signed by ${first.name ?? "someone"} and ${second.name ?? "someone"}`
      : first || second
        ? `1 of 2 signed. Waiting for the Check by list`
        : "Waiting for the Check by list",
    at: checked ? (second.at ?? first.at) : null,
  });

  const live = t.state !== STATE.DRAFT && !ENDED.includes(t.state);
  const now = live ? (steps.find((step) => !step.done) ?? null) : null;
  return steps.map((step, index) => {
    const isNow = step === now;
    const state = step.done ? GATE_STATE.DONE : isNow ? GATE_STATE.CURRENT : GATE_STATE.WAITING;
    const when = step.at ? formatDate(step.at) : null;
    return {
      ...step,
      now: isNow,
      state,
      line: when ? `${step.line} · ${when}` : step.line,
      accessibleName: `Step ${index + 1}, ${step.label}, ${step.role}, ${STATE_WORD[state].toLowerCase()}`,
    };
  });
}

/** The row's state for the palette, and the detail beside its word. Null for rows with no state of their own. */
export function sectionState(key, t, gates) {
  if (key === SECTION.DETAILS || key === SECTION.LINES) return null;
  const gate = gates.find((g) => g.key === key);
  if (gate) {
    const detail =
      key === SECTION.CHECK_BY
        ? `${[t.checkBy.first, t.checkBy.second].filter(Boolean).length} of 2 signed`
        : gate.done
          ? "Signed"
          : gate.now
            ? "Open"
            : "Not yet";
    return { state: gate.state, detail };
  }
  // Rows with no gate: the optional releasing of a Warehouse-only slip, and Received in Odoo where no PO line needs it.
  if (key === SECTION.ODOO) {
    return t.odooReceivedAt
      ? { state: GATE_STATE.DONE, detail: "Recorded" }
      : { state: GATE_STATE.WAITING, detail: "Optional" };
  }
  if (key === STAGE.WAREHOUSE_RELEASING) {
    return isSigned(t, key)
      ? { state: GATE_STATE.DONE, detail: "Signed" }
      : { state: GATE_STATE.WAITING, detail: "Optional" };
  }
  return null;
}

/** How many lines are rated GC, how many NA (either side's NA counts), and how many are rated at all. */
export function ratingCounts(t) {
  let gc = 0;
  let na = 0;
  for (const line of t.lines) {
    const ratings = [line.whRating, line.techRating].filter(Boolean);
    if (ratings.includes(TRANSMITTAL_RATING.NA)) na += 1;
    else if (ratings.length > 0) gc += 1;
  }
  return { gc, na };
}

/** The numbers strip: lines, GC, NA, and steps done. */
export function numbersOf(t, gates) {
  const { gc, na } = ratingCounts(t);
  const done = gates.filter((gate) => gate.done).length;
  return { lines: t.lines.length, gc, na, stepsDone: done, stepsTotal: gates.length };
}

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;
const pairName = (slot) => slot?.name ?? "someone";

/** The one line under each row's title. */
export function summariesOf(t, gates) {
  const { gc, na } = ratingCounts(t);
  const lines = {
    [SECTION.DETAILS]: [
      t.entity,
      `${t.priority[0].toUpperCase()}${t.priority.slice(1)} priority`,
      `prepared ${formatPreparedAt(t.preparedOn)}${t.preparedBy?.name ? ` by ${t.preparedBy.name}` : ""}`,
    ]
      .filter(Boolean)
      .join(" · "),
    [SECTION.LINES]:
      t.lines.length === 0
        ? "No lines"
        : [plural(t.lines.length, "line", "lines"), gc > 0 ? `${gc} GC` : null, na > 0 ? `${na} NA` : null]
            .filter(Boolean)
            .join(" · "),
  };
  for (const gate of gates) lines[gate.key] = gate.line;
  if (!lines[SECTION.ODOO]) {
    lines[SECTION.ODOO] = t.odooReceivedAt
      ? `Recorded by ${t.odooReceivedBy?.name ?? "someone"} · ${formatDate(t.odooReceivedAt)}`
      : "Not recorded. Optional on this slip";
  }
  if (!lines[STAGE.WAREHOUSE_RELEASING]) {
    const row = stageRowOf(t, STAGE.WAREHOUSE_RELEASING);
    lines[STAGE.WAREHOUSE_RELEASING] = row?.completed_at
      ? `Signed by ${signerName(row, "first")} and ${signerName(row, "second")}`
      : "Optional. Signed by the Warehouse before the slip closes";
  }
  if (t.checkBy.first && !t.checkBy.second) {
    lines[SECTION.CHECK_BY] = `Check by (1): ${pairName(t.checkBy.first)}. Check by (2) still open`;
  } else if (t.checkBy.second && !t.checkBy.first) {
    lines[SECTION.CHECK_BY] = `Check by (2): ${pairName(t.checkBy.second)}. Check by (1) still open`;
  }
  return lines;
}

/**
 * The steps the rail lists: every section after Details and Lines (those two are
 * the slip itself), each with its state and its one-line summary.
 */
export function railStepsOf(t, gates, summaries) {
  return sectionsOf(t)
    .filter((section) => section.key !== SECTION.DETAILS && section.key !== SECTION.LINES)
    .map((section) => ({
      ...section,
      state: sectionState(section.key, t, gates),
      summary: summaries[section.key] ?? "",
    }));
}

/** Whether a stage is open to be worked in its own state (for the row's "Open" detail). */
export function stageIsOpen(t, stage) {
  return t.state === OPEN_STATE[stage];
}

/**
 * The one line under "Your move": what the viewer can do, or who the slip
 * waits on. `offered` are the moves the viewer has; each carries the
 * `section` it belongs to, which is the gate key.
 */
export function statusLine(t, gates, offered) {
  if (t.state === STATE.CANCELLED) return "Cancelled. Nothing to do.";
  if (t.state === STATE.CLOSED) return "Closed. Nothing left to do.";
  if (t.state === STATE.DRAFT) {
    return offered.length > 0 ? "A draft. Submit it when the lines are right." : "A draft. Waiting for its preparer to submit it.";
  }
  const now = gates.find((gate) => gate.now);
  if (!now) {
    return offered.length > 0 ? "Waiting for you" : `Nothing needs you right now. ${transmittalStateLabel(t.state)}.`;
  }

  // Only a move on the next step counts: a move on an earlier step doesn't make it the viewer's turn.
  if (offered.some((item) => item.section === now.key)) return `Waiting for you: ${now.label}`;
  return `Next: ${now.label}, waiting on ${now.waitsOn}`;
}
