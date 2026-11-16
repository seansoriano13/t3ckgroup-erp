import { describe, it, expect } from "vitest";
import { CANVASS_STATE, canvassState, lineLocked, lineState, suppliersCovered } from "./canvassStatus";

const item = (status = "to_purchase") => ({ status });
const winner = { supplier_id: "s1" };

describe("suppliersCovered", () => {
  it("needs three suppliers", () => {
    expect(suppliersCovered(2)).toBe(false);
    expect(suppliersCovered(3)).toBe(true);
    expect(suppliersCovered(5)).toBe(true);
  });
  it("lets a note cover the missing second and third", () => {
    expect(suppliersCovered(1, true)).toBe(true);
    expect(suppliersCovered(2, true)).toBe(true);
  });
  it("never lets a note cover the first supplier", () => {
    expect(suppliersCovered(0, true)).toBe(false);
    expect(suppliersCovered(undefined, true)).toBe(false);
  });
});

describe("lineLocked", () => {
  it("locks a Purchased or Received line, not an open one", () => {
    expect(lineLocked(item("purchased"))).toBe(true);
    expect(lineLocked(item("received"))).toBe(true);
    expect(lineLocked(item("still_canvassing"))).toBe(false);
  });
  it("is open again once a Super Admin lifted the lock", () => {
    expect(lineLocked(item("purchased"), true)).toBe(false);
  });
});

describe("lineState", () => {
  it("needs suppliers until the Canvass is covered", () => {
    expect(lineState({ item: item(), covered: false })).toBe(CANVASS_STATE.NEEDS_SUPPLIERS);
  });
  it("needs a winner once covered", () => {
    expect(lineState({ item: item(), covered: true })).toBe(CANVASS_STATE.NEEDS_WINNER);
  });
  it("shows a picked winner", () => {
    expect(lineState({ item: item(), covered: true, winner })).toBe(CANVASS_STATE.WINNER_PICKED);
  });
  it("shows locked over a winner, and cancelled over everything", () => {
    expect(lineState({ item: item("purchased"), covered: true, winner })).toBe(CANVASS_STATE.LOCKED);
    expect(lineState({ item: item("cancelled"), covered: true, winner })).toBe(CANVASS_STATE.CANCELLED);
  });
  it("shows a line with no quotes by the Canvass, not as locked", () => {
    expect(lineState({ item: item("not_checked"), covered: true })).toBe(CANVASS_STATE.NEEDS_WINNER);
  });
});

describe("canvassState", () => {
  const open = (w = null) => ({ item: item(), winner: w });
  it("needs suppliers until covered", () => {
    expect(canvassState({ lines: [open(winner)], covered: false })).toBe(CANVASS_STATE.NEEDS_SUPPLIERS);
    expect(canvassState({ lines: [], covered: false })).toBe(CANVASS_STATE.NEEDS_SUPPLIERS);
  });
  it("needs a winner while any open line has none", () => {
    expect(canvassState({ lines: [open(winner), open()], covered: true })).toBe(CANVASS_STATE.NEEDS_WINNER);
  });
  it("has its winner picked when every open line has one", () => {
    expect(canvassState({ lines: [open(winner), open(winner)], covered: true })).toBe(CANVASS_STATE.WINNER_PICKED);
  });
  it("ignores cancelled lines", () => {
    const cancelled = { item: item("cancelled"), winner: null };
    expect(canvassState({ lines: [open(winner), cancelled], covered: true })).toBe(CANVASS_STATE.WINNER_PICKED);
  });
  it("is locked only when every counted line is locked; a line added later opens it", () => {
    const locked = { item: item("purchased"), winner };
    expect(canvassState({ lines: [locked, locked], covered: true })).toBe(CANVASS_STATE.LOCKED);
    expect(canvassState({ lines: [locked, open()], covered: true })).toBe(CANVASS_STATE.NEEDS_WINNER);
    expect(canvassState({ lines: [locked, open(winner)], covered: true })).toBe(CANVASS_STATE.WINNER_PICKED);
  });
  it("is not locked with no lines", () => {
    expect(canvassState({ lines: [], covered: true })).toBe(CANVASS_STATE.NEEDS_WINNER);
  });
});
