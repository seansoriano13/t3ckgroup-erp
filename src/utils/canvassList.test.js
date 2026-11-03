import { describe, it, expect } from "vitest";

import { CANVASS_KIND } from "../constants/canvass";
import {
  ANY,
  CANVASS_STATE_TONES,
  REQUEST_FILTER,
  canvassExportRows,
  canvassRequestRef,
  canvassRequestState,
  canvassStateOf,
  filterCanvasses,
} from "./canvassList";

/**
 * The Request sign on a Canvass (list column, panel strip, and filter): what a purchaser reads to
 * know whether a Purchase Request still has to be made from it.
 */

const bare = (extra = {}) => ({ id: "c1", number: "CNV_0001", kind: CANVASS_KIND.NONE, winner: null, requestId: null, ...extra });
const withWinner = { id: "o1", supplierName: "Ink Depot", brand: "HP" };

describe("canvassRequestState", () => {
  it("says a Canvass with no subject and no winner needs a winner", () => {
    expect(canvassRequestState(bare())).toMatchObject({ key: "needs_winner", label: "Needs winner", requestId: null });
  });

  it("says a Canvass with no subject and a winner is ready to request", () => {
    expect(canvassRequestState(bare({ winner: withWinner }))).toMatchObject({ key: "ready", label: "Ready to request", requestId: null });
  });

  it("says the status of the request's item once one was made, and keeps the request name apart", () => {
    const state = canvassRequestState(
      bare({ kind: CANVASS_KIND.REQUESTED_ITEM, winner: withWinner, requestId: "pr-12", requestLabel: "PR-12", requestItemStatus: "cancelled" }),
    );
    expect(state).toMatchObject({ key: "created", label: "Cancelled", requestLabel: "PR-12", requestId: "pr-12" });
  });

  it("falls back to the request name when its status is not known", () => {
    expect(canvassRequestState(bare({ kind: CANVASS_KIND.REQUESTED_ITEM, requestId: "pr-12", requestLabel: "PR-12" }))).toMatchObject({
      key: "created",
      label: "PR-12",
    });
  });

  it("shows nothing on a project Component Canvass", () => {
    expect(canvassRequestState(bare({ kind: CANVASS_KIND.COMPONENT, winner: withWinner }))).toBeNull();
  });
});

describe("canvassStateOf", () => {
  const requested = (extra = {}) => bare({ kind: CANVASS_KIND.REQUESTED_ITEM, winner: withWinner, requestId: "pr-12", requestLabel: "PR-12", ...extra });

  it("says Open with no winner and Winner picked with one", () => {
    expect(canvassStateOf(bare())).toMatchObject({ state: "open", label: "Open" });
    expect(canvassStateOf(bare({ winner: withWinner }))).toMatchObject({ state: "won", label: "Winner picked" });
  });

  it("says the live status of the request's item once a request was made", () => {
    expect(canvassStateOf(requested({ requestItemStatus: "still_canvassing" }))).toMatchObject({ state: "still_canvassing", label: "Still canvassing" });
    expect(canvassStateOf(requested({ requestItemStatus: "cancelled" }))).toMatchObject({ state: "cancelled", label: "Cancelled" });
  });

  it("says Requested when the item's status is not known", () => {
    expect(canvassStateOf(requested())).toMatchObject({ state: "requested", label: "Requested" });
  });

  it("puts Signed off before the request status", () => {
    expect(canvassStateOf(requested({ requestItemStatus: "purchased", signedOffAt: "2026-01-01" }))).toMatchObject({ state: "signed", label: "Signed off" });
  });

  it("has a badge tone for every item status", () => {
    for (const status of ["not_checked", "available", "to_purchase", "still_canvassing", "purchased", "received", "cannot_source", "cancelled"]) {
      expect(CANVASS_STATE_TONES[status]).toBeTruthy();
    }
  });
});

describe("canvassRequestRef", () => {
  it("is the request's reference once one was made", () => {
    expect(canvassRequestRef(bare({ requestId: "pr-12", requestLabel: "PR-12", requestItemStatus: "cancelled" }))).toBe("PR-12");
  });

  it("is empty before a request, so the State column is the only badge", () => {
    expect(canvassRequestRef(bare())).toBeNull();
    expect(canvassRequestRef(bare({ winner: withWinner }))).toBeNull();
    expect(canvassRequestRef(bare({ kind: CANVASS_KIND.COMPONENT }))).toBeNull();
  });
});

describe("canvassExportRows", () => {
  it("puts the reference in Request and the live status in State", () => {
    const row = bare({ kind: CANVASS_KIND.REQUESTED_ITEM, winner: withWinner, requestId: "pr-12", requestLabel: "PR-12", requestItemStatus: "purchased" });
    const [cells] = canvassExportRows([row]);
    expect(cells[5]).toBe("PR-12");
    expect(cells[7]).toBe("Purchased");
  });
});

describe("filterCanvasses by request", () => {
  const rows = [
    bare({ id: "a", number: "CNV_0001" }),
    bare({ id: "b", number: "CNV_0002", winner: withWinner }),
    bare({ id: "c", number: "CNV_0003", kind: CANVASS_KIND.REQUESTED_ITEM, requestId: "pr-1", requestLabel: "PR-1", requestItemStatus: "purchased" }),
    bare({ id: "d", number: "CNV_0004", kind: CANVASS_KIND.COMPONENT }),
  ];
  const ids = (request) => filterCanvasses(rows, { request }).map((r) => r.id);

  it("keeps every Canvass when no request filter is on", () => {
    expect(ids(ANY)).toEqual(["a", "b", "c", "d"]);
  });

  it("keeps the ones that still need a request", () => {
    expect(ids(REQUEST_FILTER.NOT_YET)).toEqual(["a", "b"]);
  });

  it("keeps the ones that have a request", () => {
    expect(ids(REQUEST_FILTER.CREATED)).toEqual(["c"]);
  });
});
