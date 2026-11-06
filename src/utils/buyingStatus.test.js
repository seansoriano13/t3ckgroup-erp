import { describe, it, expect } from "vitest";
import { buyingStatus, lineBuyingStatus } from "./buyingStatus";

const item = (status) => ({ status });

describe("buyingStatus", () => {
  it("is null when nothing is requested", () => {
    expect(buyingStatus([])).toBeNull();
    expect(lineBuyingStatus({ components: [] })).toBeNull();
  });

  it("says the Purchase Request's own word", () => {
    expect(buyingStatus([item("to_purchase")]).label).toBe("To purchase");
    expect(buyingStatus([item("not_checked")]).label).toBe("Not checked");
  });

  it("counts a mix against the furthest status", () => {
    const s = buyingStatus([item("purchased"), item("purchased"), item("to_purchase")]);
    expect(s).toMatchObject({ label: "2 of 3 Purchased", mixed: true });
  });

  it("ignores cancelled items while a live one is left, and shows them when none is", () => {
    expect(buyingStatus([item("received"), item("cancelled")]).label).toBe("Received");
    expect(buyingStatus([item("cancelled")]).label).toBe("Cancelled");
    expect(buyingStatus([item("cannot_source")]).label).toBe("Cannot source");
  });

  it("reads every part of a line together", () => {
    const line = { components: [{ purchases: { requests: [item("received")] } }, { purchases: { requests: [item("to_purchase")] } }] };
    expect(lineBuyingStatus(line).label).toBe("1 of 2 Received");
  });
});
