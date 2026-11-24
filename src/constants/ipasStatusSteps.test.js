import { describe, expect, it } from "vitest";
import { IPAS_STATUS, IPAS_STATUSES, IPAS_STATUS_LABELS } from "./ipas";
import { IPAS_STATUS_THEME } from "./status";

describe("a stored 'processing' (#1206)", () => {
  it("reads as In Production on the screen, but is not a step to pick", () => {
    expect(IPAS_STATUS_LABELS.processing).toBe("In Production");
    expect(IPAS_STATUSES).not.toContain("processing");
  });
});

describe("the IPAS Status steps are listed once (#1151)", () => {
  it("keeps the team's words and order, with one constant, one label and one colour per step", () => {
    expect(IPAS_STATUSES.map((key) => IPAS_STATUS_LABELS[key])).toEqual([
      "Order-Draft",
      "Payment Approval",
      "For Payment",
      "Ordered",
      "In Production",
      "Ready for Shipment",
      "Shipped / Picked Up",
      "In Transit",
      "Customs / Port Hold",
      "Arrived at Local Hub",
      "Out for Delivery",
      "Delivered",
      "Done",
    ]);
    for (const key of IPAS_STATUSES) {
      expect(IPAS_STATUS[key.toUpperCase()], `${key} has a constant`).toBe(key);
      expect(IPAS_STATUS_THEME[key.toUpperCase()], `${key} has a colour in IPAS_STATUS_THEME`).toBeTruthy();
    }
  });
});
