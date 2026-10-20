import { describe, expect, it } from "vitest";

import { TRANSMITTAL_STAFF_LIST as LIST, TRANSMITTAL_STAGE as STAGE, TRANSMITTAL_STATE as STATE } from "@/constants/transmittals";
import { shapeTransmittal } from "@/utils/transmittals";
import { EMPTY_STAGE_FORM, footerMovesFor, movesFor, stageBlocker } from "./transmittalMoves";
import {
  SECTION,
  gatesOf,
  numbersOf,
  rightsOf,
  sectionState,
  sectionsOf,
  statusLine,
  summariesOf,
} from "./transmittalRecord";

const ME = "u-me";
const OTHER = "u-other";

function line(position, over = {}) {
  return {
    id: `l${position}`,
    position,
    kind: "typed",
    description: `Item ${position}`,
    quantity: 1,
    wh_rating: null,
    tech_rating: null,
    ...over,
  };
}

function slip(over = {}) {
  return shapeTransmittal({
    id: "t1",
    number: "TG03_0001",
    prepared_on: "2026-10-01",
    prepared_by: OTHER,
    origin: "purchasing",
    check_warehouse: true,
    check_technical: false,
    priority: "high",
    entity: "T3CK Trading",
    state: STATE.WAREHOUSE_CHECKING,
    created_at: "2026-10-01T00:00:00Z",
    lines: [line(1), line(2)],
    stages: [{ id: "s1", stage: STAGE.WAREHOUSE_CHECKING, completed_at: null }],
    ...over,
  });
}

const signedStage = (stage, id = "s1") => ({
  id,
  stage,
  completed_at: "2026-10-02T01:00:00Z",
  first_signer: { name: "Ann" },
  first_signer_id: OTHER,
  second_signer_name: "Bob",
  second_confirmed: true,
  first_confirmed: true,
});

describe("sectionsOf", () => {
  it("shows a draft only its details and lines", () => {
    const t = slip({ state: STATE.DRAFT, stages: [] });
    expect(sectionsOf(t).map((s) => s.key)).toEqual([SECTION.DETAILS, SECTION.LINES]);
  });

  it("hides stages the Checking boxes did not tick", () => {
    const t = slip({ check_warehouse: false, check_technical: true, state: STATE.TECHNICAL_INSPECTION, stages: [
      { id: "s9", stage: STAGE.TECHNICAL_INSPECTION, completed_at: null },
    ] });
    const keys = sectionsOf(t).map((s) => s.key);
    expect(keys).toContain(STAGE.TECHNICAL_INSPECTION);
    expect(keys).not.toContain(STAGE.WAREHOUSE_CHECKING);
    expect(keys).not.toContain(STAGE.WAREHOUSE_RELEASING);
    expect(keys.at(-1)).toBe(SECTION.CHECK_BY);
  });

  it("lists releasing between checking and technical when both are ticked", () => {
    const t = slip({ check_technical: true });
    const keys = sectionsOf(t).map((s) => s.key);
    expect(keys.slice(2, 5)).toEqual([STAGE.WAREHOUSE_CHECKING, STAGE.WAREHOUSE_RELEASING, STAGE.TECHNICAL_INSPECTION]);
  });
});

describe("gatesOf and the numbers strip", () => {
  it("makes the first unsigned step Now, and counts steps done", () => {
    const t = slip({
      check_technical: true,
      state: STATE.WAREHOUSE_RELEASING,
      stages: [signedStage(STAGE.WAREHOUSE_CHECKING)],
    });
    const gates = gatesOf(t);
    expect(gates.map((g) => g.key)).toEqual([
      STAGE.WAREHOUSE_CHECKING,
      STAGE.WAREHOUSE_RELEASING,
      STAGE.TECHNICAL_INSPECTION,
      SECTION.CHECK_BY,
    ]);
    expect(gates.filter((g) => g.now).map((g) => g.key)).toEqual([STAGE.WAREHOUSE_RELEASING]);
    expect(numbersOf(t, gates)).toMatchObject({ stepsDone: 1, stepsTotal: 4 });
  });

  it("counts Received in Odoo as a step only when a PO line needs it", () => {
    const withPo = slip({ lines: [line(1, { kind: "po_line" })] });
    expect(gatesOf(withPo).map((g) => g.key)).toContain(SECTION.ODOO);
    expect(gatesOf(slip()).map((g) => g.key)).not.toContain(SECTION.ODOO);
  });

  it("has no step Now on a draft or a cancelled slip", () => {
    expect(gatesOf(slip({ state: STATE.DRAFT, stages: [] })).some((g) => g.now)).toBe(false);
    expect(gatesOf(slip({ state: STATE.CANCELLED })).some((g) => g.now)).toBe(false);
  });

  it("counts GC and NA lines, and a line with either side NA as NA", () => {
    const t = slip({
      lines: [line(1, { wh_rating: "gc" }), line(2, { wh_rating: "gc", tech_rating: "na" }), line(3)],
    });
    expect(numbersOf(t, gatesOf(t))).toMatchObject({ lines: 3, gc: 1, na: 1 });
  });
});

describe("rightsOf", () => {
  it("lets only the Warehouse list sign checking, and only in that state", () => {
    const t = slip();
    expect(rightsOf(t, { userId: ME, lists: [LIST.WAREHOUSE] }).canSign[STAGE.WAREHOUSE_CHECKING]).toBe(true);
    expect(rightsOf(t, { userId: ME, lists: [LIST.TECHNICAL] }).canSign[STAGE.WAREHOUSE_CHECKING]).toBe(false);
    const later = slip({ state: STATE.AWAITING_CHECK });
    expect(rightsOf(later, { userId: ME, lists: [LIST.WAREHOUSE] }).canSign[STAGE.WAREHOUSE_CHECKING]).toBe(false);
  });

  it("holds Check by until Received in Odoo is signed on a PO slip", () => {
    const t = slip({ state: STATE.AWAITING_CHECK, lines: [line(1, { kind: "po_line" })] });
    const rights = rightsOf(t, { userId: ME, lists: [LIST.CHECK_BY] });
    expect(rights.checkBy.first).toBe(false);
    expect(rights.checkByBlocked).toBe(true);
  });

  it("keeps the same person from taking both Check by plates", () => {
    const t = slip({ state: STATE.AWAITING_CHECK, check_by_first_id: ME, check_by_first: { name: "Me" } });
    const rights = rightsOf(t, { userId: ME, lists: [LIST.CHECK_BY] });
    expect(rights.checkBy).toEqual({ first: false, second: false });
  });

  it("allows cancelling only before a stage is signed", () => {
    const owner = { userId: OTHER, lists: [] };
    expect(rightsOf(slip(), owner).canCancel).toBe(true);
    expect(rightsOf(slip({ stages: [signedStage(STAGE.WAREHOUSE_CHECKING)] }), owner).canCancel).toBe(false);
  });
});

describe("movesFor", () => {
  const noop = () => {};
  const on = { open: noop, submit: noop, signStage: noop, confirmStage: noop, recordOdoo: noop, checkBy: noop };
  const build = (t, viewer, forms = {}, odooRef = "") => movesFor(t, rightsOf(t, viewer), { forms, odooRef, on });

  it("offers Submit to the preparer of a draft with lines", () => {
    const t = slip({ state: STATE.DRAFT, stages: [], prepared_by: ME });
    expect(build(t, { userId: ME }).moves.map((m) => m.key)).toEqual(["submit"]);
  });

  it("offers a stage's signature with what is missing as its hint", () => {
    const t = slip();
    const { moves } = build(t, { userId: ME, lists: [LIST.WAREHOUSE] });
    // As before: the optional releasing and Received in Odoo are open to the Warehouse while the slip is open.
    expect(moves.map((m) => m.key)).toEqual([
      `sign-${STAGE.WAREHOUSE_CHECKING}`,
      `sign-${STAGE.WAREHOUSE_RELEASING}`,
      `sign-${SECTION.ODOO}`,
    ]);
    expect(moves[0].hint).toBe("2 lines still need a GC or NA rating.");
    expect(moves[0].confirm).toBe(false);
  });

  it("asks first once the stage is ready to sign", () => {
    const t = slip({
      lines: [line(1, { wh_rating: "gc", wh_in_charge_id: ME })],
      evidence: [{ id: "e1", record_id: "s1", file_name: "a.jpg", kind: "picture" }],
    });
    const forms = { [STAGE.WAREHOUSE_CHECKING]: { ...EMPTY_STAGE_FORM, otherId: OTHER } };
    const [sign] = build(t, { userId: ME, lists: [LIST.WAREHOUSE] }, forms).moves;
    expect(stageBlocker(t, STAGE.WAREHOUSE_CHECKING, forms[STAGE.WAREHOUSE_CHECKING])).toBeNull();
    expect(sign.confirm).toBe(true);
  });

  it("offers the co-signer Confirm and Decline on a signed stage", () => {
    const t = slip({
      state: STATE.AWAITING_CHECK,
      stages: [
        {
          ...signedStage(STAGE.WAREHOUSE_CHECKING),
          second_signer_id: ME,
          second_confirmed: false,
          second_signature_declined: false,
        },
      ],
    });
    const built = build(t, { userId: ME });
    expect(built.moves.map((m) => m.key)).toEqual([`confirm-${STAGE.WAREHOUSE_CHECKING}`]);
    expect(built.declines.map((m) => m.key)).toEqual([`decline-${STAGE.WAREHOUSE_CHECKING}`]);
    expect(footerMovesFor(built, STAGE.WAREHOUSE_CHECKING)).toHaveLength(2);
    expect(footerMovesFor(built, SECTION.CHECK_BY)).toHaveLength(0);
  });

  it("offers Check by (1) and (2) on a slip awaiting Check by", () => {
    const t = slip({ state: STATE.AWAITING_CHECK, stages: [signedStage(STAGE.WAREHOUSE_CHECKING)] });
    const keys = build(t, { userId: ME, lists: [LIST.CHECK_BY] }).moves.map((m) => m.key);
    expect(keys).toEqual(["check-1", "check-2"]);
  });
});

describe("undo signature (#538)", () => {
  const noop = () => {};
  const on = { open: noop, submit: noop, signStage: noop, confirmStage: noop, recordOdoo: noop, checkBy: noop, askUndo: noop };
  const undosOf = (t, viewer) => movesFor(t, rightsOf(t, viewer), { forms: {}, odooRef: "", on }).undos.map((m) => m.key);

  it("offers a signed stage's undo to the list that signs it, latest step first", () => {
    const t = slip({
      check_technical: true,
      state: STATE.TECHNICAL_INSPECTION,
      stages: [
        signedStage(STAGE.WAREHOUSE_CHECKING, "s1"),
        { ...signedStage(STAGE.WAREHOUSE_RELEASING, "s2") },
        { id: "s3", stage: STAGE.TECHNICAL_INSPECTION, completed_at: null },
      ],
    });
    // Releasing is the latest signed stage; checking waits for it.
    expect(undosOf(t, { userId: ME, lists: [LIST.WAREHOUSE] })).toEqual([`undo-${STAGE.WAREHOUSE_RELEASING}`]);
    expect(undosOf(t, { userId: ME, lists: [LIST.TECHNICAL] })).toEqual([]);
    expect(undosOf(t, { userId: ME, lists: [] })).toEqual([]);
  });

  it("holds a stage and Received in Odoo while a Check by is signed", () => {
    const t = slip({
      state: STATE.AWAITING_CHECK,
      odoo_received_at: "2026-10-03T01:00:00Z",
      stages: [signedStage(STAGE.WAREHOUSE_CHECKING)],
      check_by_first_id: OTHER,
      check_by_first: { name: "Cy" },
      check_by_first_at: "2026-10-04T01:00:00Z",
    });
    expect(undosOf(t, { userId: ME, lists: [LIST.WAREHOUSE] })).toEqual([]);
    expect(undosOf(t, { userId: ME, lists: [LIST.CHECK_BY] })).toEqual(["undo-check-1"]);
  });

  it("lets a Check by be undone on a closed slip, but not by the preparer", () => {
    const t = slip({
      state: STATE.CLOSED,
      stages: [signedStage(STAGE.WAREHOUSE_CHECKING)],
      check_by_first_id: OTHER,
      check_by_first: { name: "Cy" },
      check_by_first_at: "2026-10-04T01:00:00Z",
      check_by_second_id: "u-third",
      check_by_second: { name: "Di" },
      check_by_second_at: "2026-10-04T02:00:00Z",
    });
    expect(undosOf(t, { userId: ME, lists: [LIST.CHECK_BY] })).toEqual(["undo-check-1", "undo-check-2"]);
    // The preparer here is OTHER; the preparer can't undo a Check by of their own slip.
    expect(undosOf(t, { userId: OTHER, lists: [LIST.CHECK_BY] })).toEqual([]);
  });

  it("offers Received in Odoo's undo to the Warehouse list or Purchasing", () => {
    const t = slip({ odoo_received_at: "2026-10-03T01:00:00Z", odoo_received_by: OTHER, state: STATE.AWAITING_CHECK });
    expect(undosOf(t, { userId: ME, lists: [LIST.WAREHOUSE] })).toContain("undo-odoo");
    expect(undosOf(t, { userId: ME, hasPurchasingFlow: true })).toContain("undo-odoo");
    expect(undosOf(t, { userId: ME, lists: [LIST.TECHNICAL] })).not.toContain("undo-odoo");
  });
});

describe("statusLine, sectionState and summaries", () => {
  it("says what the viewer can do, or who the slip waits on", () => {
    const t = slip();
    const gates = gatesOf(t);
    expect(statusLine(t, gates, [{ section: STAGE.WAREHOUSE_CHECKING }])).toBe("Waiting for you: Warehouse checking");
    expect(statusLine(t, gates, [])).toBe("Next: Warehouse checking, waiting on the Warehouse");
    // A move on another step is not the viewer's turn.
    expect(statusLine(t, gates, [{ section: SECTION.CHECK_BY }])).toBe("Next: Warehouse checking, waiting on the Warehouse");
    expect(statusLine(slip({ state: STATE.CLOSED }), [], [])).toBe("Closed. Nothing left to do.");
  });

  it("gives each stage row a state word and one summary line", () => {
    const t = slip({ state: STATE.AWAITING_CHECK, stages: [signedStage(STAGE.WAREHOUSE_CHECKING)] });
    const gates = gatesOf(t);
    expect(sectionState(STAGE.WAREHOUSE_CHECKING, t, gates)).toEqual({ state: "done", detail: "Signed" });
    expect(sectionState(SECTION.CHECK_BY, t, gates)).toEqual({ state: "current", detail: "0 of 2 signed" });
    expect(summariesOf(t, gates)[STAGE.WAREHOUSE_CHECKING]).toMatch(/^Signed by Ann and Bob/);
  });
});
