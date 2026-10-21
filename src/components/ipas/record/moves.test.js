import { describe, expect, it } from "vitest";

import { cardMovesFor, footerMovesFor } from "./moves";

const none = { canApprove: false, canPrepare: false, returnMode: null };
const noRole = { canGive: false };

/** The viewer's rights; `over` replaces a stored section's rights or section 7's roles. */
function ctxOf({ s1, s3, s6, s7 } = {}) {
  return {
    rights: {
      1: { ...none, ...s1 },
      3: { ...none, ...s3 },
      6: { ...none, ...s6 },
      7: { received: noRole, noted: noRole, checked: noRole, approved: noRole, ...s7 },
      sendBack7: false,
    },
    can: { change: false },
    on: {},
  };
}

const digest = {
  gates: [],
  costsComplete: true,
  computationStatus: "lc_odoo_done",
  s1: {},
  s3: {},
  s6: {},
  s7: {},
};

const labels = (moves) => moves.map((item) => item.label);

describe("cardMovesFor: the earliest section only", () => {
  it("keeps the earliest section's moves and lists the rest in screen order, section 3 included", () => {
    const ctx = ctxOf({ s1: { canPrepare: true }, s3: { canPrepare: true }, s6: { canApprove: true } });
    const card = cardMovesFor(ctx, digest);

    expect(labels(card.moves)).toEqual(["Submit section 1"]);
    expect(card.also).toEqual(["finance", "costing"]);
  });

  it("moves on to the next section once the earlier one has no move", () => {
    const ctx = ctxOf({ s3: { canApprove: true }, s6: { canPrepare: true } });
    const card = cardMovesFor(ctx, digest);

    expect(labels(card.moves)).toEqual(["Approve section 2"]);
    expect(card.also).toEqual(["costing"]);
  });

  it("offers section 3 on its own with nothing else listed", () => {
    const card = cardMovesFor(ctxOf({ s6: { canApprove: true } }), digest);

    expect(labels(card.moves)).toEqual(["Approve section 3"]);
    expect(card.also).toEqual([]);
  });

  it("lists nothing when the viewer has no move", () => {
    const card = cardMovesFor(ctxOf(), digest);

    expect(card.moves).toEqual([]);
    expect(card.also).toEqual([]);
  });

  it("still returns every move in `all` for the status line, and leaves the drawer footers whole", () => {
    const ctx = ctxOf({ s1: { canPrepare: true }, s3: { canPrepare: true } });
    const card = cardMovesFor(ctx, digest);

    expect(labels(card.all)).toEqual(["Submit section 1", "Submit section 2"]);
    expect(labels(footerMovesFor(ctx, digest, "finance"))).toEqual(["Submit section 2"]);
  });

  it("keeps the Return button and the section's Return / Undo moves as they are", () => {
    const ctx = ctxOf({ s1: { canPrepare: true }, s3: { returnMode: "undo" } });
    const card = cardMovesFor(ctx, digest);

    expect(labels(card.returns)).toEqual(["Undo approval…"]);
    expect(labels(card.bySection)).toEqual(["Undo approval of section 2"]);
  });

  it("offers Return and Undo approval on section 3 (stored 6), with hints", () => {
    const ctx = ctxOf({ s6: { returnMode: "return" } });
    const card = cardMovesFor(ctx, digest);
    expect(labels(card.bySection)).toEqual(["Return section 3"]);
    expect(card.bySection[0].hint).toMatch(/Clears Submitted and Approved/);

    const undo = cardMovesFor(ctxOf({ s6: { returnMode: "undo" } }), digest);
    expect(labels(undo.bySection)).toEqual(["Undo approval of section 3"]);
    expect(undo.bySection[0].hint).toMatch(/Takes back the approval only/);
  });
});

describe("cardMovesFor: section 4 earliest", () => {
  it("shows both Noted and Checked, which can be given in either order", () => {
    const ctx = ctxOf({ s7: { noted: { canGive: true }, checked: { canGive: true } } });
    const card = cardMovesFor(ctx, digest);

    expect(labels(card.moves)).toEqual(["Note section 4", "Check section 4"]);
    expect(card.also).toEqual([]);
  });
});
