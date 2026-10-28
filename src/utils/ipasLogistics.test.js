import { describe, expect, it } from "vitest";
import { logisticsMissing } from "./ipasLogistics";

describe("logisticsMissing (#713)", () => {
  it("names everything an empty IPAS lacks", () => {
    expect(logisticsMissing({})).toEqual(["the Item Location", "a Transmittal", "the received date"]);
  });

  it("takes the Item Location from the Transmittals", () => {
    const ipas = { itemLocation: { label: "WH1" }, slips: [{ id: "t1" }], arrived_in_whs_on: "2026-10-20" };
    expect(logisticsMissing(ipas)).toEqual([]);
  });

  it("still asks for the received date once placed", () => {
    expect(logisticsMissing({ item_location_id: "l1", slips: [{ id: "t1" }] })).toEqual(["the received date"]);
  });
});
