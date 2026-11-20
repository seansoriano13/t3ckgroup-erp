import { describe, expect, it } from "vitest";
import { logisticsMissing } from "./ipasLogistics";

const delivered = [{ step: "delivered", on: "2026-10-20" }];

describe("logisticsMissing (#713, #1154)", () => {
  it("names everything an empty IPAS lacks", () => {
    expect(logisticsMissing({})).toEqual(["the Item Location", "a Transmittal", "the Delivered status"]);
  });

  it("takes the Item Location from the Transmittals", () => {
    const ipas = { itemLocation: { label: "WH1" }, slips: [{ id: "t1" }], statusSteps: delivered };
    expect(logisticsMissing(ipas)).toEqual([]);
  });

  it("still asks for Delivered once placed", () => {
    expect(logisticsMissing({ item_location_id: "l1", slips: [{ id: "t1" }] })).toEqual(["the Delivered status"]);
  });

  it("asks a Local IPAS for Delivered too", () => {
    expect(logisticsMissing({ source: "local", item_location_id: "l1", slips: [{ id: "t1" }] })).toEqual(["the Delivered status"]);
    expect(logisticsMissing({ source: "local", item_location_id: "l1", slips: [{ id: "t1" }], statusSteps: delivered })).toEqual([]);
  });
});
