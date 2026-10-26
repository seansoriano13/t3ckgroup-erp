import { describe, expect, it } from "vitest";
import { ago, askedByText, lineNotes, mergedRequestOf, splitProductName, stockCell } from "./productLine";

const NOW = new Date("2026-10-26T12:00:00Z").getTime();
const hoursBefore = (n) => new Date(NOW - n * 3600 * 1000).toISOString();

describe("splitProductName", () => {
  it("takes Odoo's leading [code] off the name", () => {
    expect(splitProductName("[M18C] Milwaukee Charger M18")).toEqual({ name: "Milwaukee Charger M18", code: "M18C" });
  });
  it("leaves a name with no code alone", () => {
    expect(splitProductName("Rescue Tube")).toEqual({ name: "Rescue Tube", code: null });
    expect(splitProductName("Cable [red] 2m")).toEqual({ name: "Cable [red] 2m", code: null });
  });
});

describe("stockCell", () => {
  it("is green, amber or red by how much is free, and grey when not read", () => {
    expect(stockCell({ figure: "12 free, enough", badge: { kind: "AVAILABLE" } })).toEqual({ text: "12 free, enough", tone: "enough" });
    expect(stockCell({ figure: "1 free of 2", badge: { kind: "PARTIAL" } }).tone).toBe("some");
    expect(stockCell({ figure: "0 free", badge: { kind: "OUT_OF_STOCK" } }).tone).toBe("none-left");
    expect(stockCell({ figure: "Not tracked", badge: { kind: "NOT_TRACKED" } }).tone).toBe("none");
    expect(stockCell(null)).toEqual({ text: "Not read yet", tone: "none" });
  });
});

describe("lineNotes", () => {
  const s0 = { sor_item_id: "x", status: "to_purchase" };
  it("says RFQ on an RFQ", () => {
    expect(lineNotes({ ...s0, po_number: "P09718", po_state: "rfq" })).toEqual([{ text: "RFQ P09718" }]);
  });
  it("says how a bought line is coming", () => {
    const bought = { ...s0, status: "purchased", po_number: "P09683", po_ordered: 6, po_received: 3 };
    expect(lineNotes(bought)).toEqual([{ text: "3 of 6 received" }]);
  });
  it("warns about a line Sales removed, a stock drop and an S0 that still lists a replaced product", () => {
    expect(lineNotes({ ...s0, removed_from_s0: true })).toEqual([{ text: "Removed from S0", warn: true }]);
    expect(lineNotes({ status: "available", stock_short_free: 1, stock_short_needed: 4 })).toEqual([{ text: "Now 1 free of 4", warn: true }]);
    expect(lineNotes({ ...s0, name: "Pruner", s0_still_lists: true })[0].warn).toBe(true);
  });
  it("has nothing to say about a quiet line", () => {
    expect(lineNotes(s0)).toEqual([]);
  });
});

describe("askedByText", () => {
  it("names the side and how long ago", () => {
    const item = { created_at: hoursBefore(50), requester: { name: "Ana" } };
    expect(askedByText(item, "sales", NOW)).toBe("Asked by Sales · 2 days ago");
    expect(askedByText(item, "purchasing", NOW)).toBe("Added by Purchasing · 2 days ago");
    expect(askedByText(item, null, NOW)).toBe("Asked by Ana · 2 days ago");
  });
});

describe("ago", () => {
  it("reads in the fewest words", () => {
    expect(ago(hoursBefore(0.2), NOW)).toBe("just now");
    expect(ago(hoursBefore(5), NOW)).toBe("5 hours ago");
    expect(ago(hoursBefore(30), NOW)).toBe("yesterday");
  });
});

describe("mergedRequestOf", () => {
  it("finds the request that closed because its P0 moved onto the line", () => {
    const line = { sor_item_id: "s", name: "Rescue Boat" };
    const request = { id: "r", closed_note: "Closed · P09731 and its delivery moved onto Rescue Boat" };
    expect(mergedRequestOf(line, [line, request])).toBe(request);
    expect(mergedRequestOf(line, [line])).toBeNull();
    expect(mergedRequestOf(request, [line, request])).toBeNull();
  });
});
