import { describe, expect, it } from "vitest";

import { IPAS_STATUS_LABELS } from "../constants/ipas";
import { statusDatesOutOfOrder } from "./ipasStatusDates";

const STEPS = ["order_draft", "ordered", "shipped", "in_transit", "delivered", "done"];

describe("statusDatesOutOfOrder", () => {
  it("warns on a step dated before an earlier step", () => {
    const w = statusDatesOutOfOrder(STEPS, [
      { step: "ordered", on: "2026-11-10" },
      { step: "shipped", on: "2026-11-18" },
      { step: "in_transit", on: "2026-11-15" },
    ]);
    expect([...w.keys()]).toEqual(["in_transit"]);
    expect(w.get("in_transit")).toEqual({ label: IPAS_STATUS_LABELS.shipped, on: "2026-11-18" });
  });

  it("ignores Order-Draft, skipped steps, and dates in order", () => {
    const w = statusDatesOutOfOrder(STEPS, [
      { step: "order_draft", on: "2026-11-20" },
      { step: "ordered", on: "2026-11-13" },
      { step: "delivered", on: "2026-11-19" },
    ]);
    expect(w.size).toBe(0);
  });
});
