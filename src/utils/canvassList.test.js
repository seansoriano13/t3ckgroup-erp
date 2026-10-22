import { describe, it, expect } from "vitest";

import { CANVASS_KIND } from "../constants/canvass";
import { ANY, REQUEST_FILTER, canvassRequestState, filterCanvasses } from "./canvassList";

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

  it("names the request and its current status once one was made", () => {
    const state = canvassRequestState(
      bare({ kind: CANVASS_KIND.REQUESTED_ITEM, winner: withWinner, requestId: "pr-12", requestLabel: "PR-12", requestItemStatus: "cancelled" }),
    );
    expect(state).toMatchObject({ key: "created", label: "PR-12 · Cancelled", requestId: "pr-12" });
  });

  it("names the request alone when its status is not known", () => {
    expect(canvassRequestState(bare({ kind: CANVASS_KIND.REQUESTED_ITEM, requestId: "pr-12", requestLabel: "PR-12" }))).toMatchObject({
      key: "created",
      label: "PR-12",
    });
  });

  it("shows nothing on a project Component Canvass", () => {
    expect(canvassRequestState(bare({ kind: CANVASS_KIND.COMPONENT, winner: withWinner }))).toBeNull();
  });
});

describe("filterCanvasses by request", () => {
  const rows = [
    bare({ id: "a", number: "CNV_0001" }),
    bare({ id: "b", number: "CNV_0002", winner: withWinner }),
    bare({ id: "c", number: "CNV_0003", kind: CANVASS_KIND.REQUESTED_ITEM, requestId: "pr-1", requestLabel: "PR-1", requestItemStatus: "ordered" }),
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
