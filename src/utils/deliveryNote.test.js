import { describe, expect, it } from "vitest";
import { deliveryNote } from "./deliveryNote";

const bought = (extra) => ({ status: "purchased", po_ordered: 6, po_received: 0, po_eta: null, ...extra });

describe("deliveryNote", () => {
  it("flags an ETA that is already past as late (A39)", () => {
    expect(deliveryNote(bought({ po_eta: "2026-10-08" }), new Date(2026, 9, 29))).toBe("Not received yet · ETA Oct 8 (late)");
    expect(deliveryNote(bought({ po_eta: "2026-10-29" }), new Date(2026, 9, 29))).toBe("Not received yet · ETA Oct 29");
  });

  it("says nothing arrived yet, with the ETA when Odoo has one", () => {
    expect(deliveryNote(bought({ po_eta: "2026-11-12" }), new Date(2026, 9, 29))).toBe("Not received yet · ETA Nov 12");
    expect(deliveryNote(bought())).toBe("Not received yet · no ETA set");
  });
  it("counts a partial receipt", () => {
    expect(deliveryNote(bought({ po_received: 3 }))).toBe("3 of 6 received");
  });
  it("has no note for a full receipt or any other status", () => {
    expect(deliveryNote(bought({ po_received: 6 }))).toBeNull();
    expect(deliveryNote({ ...bought(), status: "received" })).toBeNull();
    expect(deliveryNote({ ...bought(), status: "to_purchase" })).toBeNull();
  });
});
