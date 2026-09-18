import { describe, it, expect } from "vitest";
import { stockBadge, STOCK_BADGE } from "./stock";

const trackedProduct = (overrides = {}) => ({ type: "product", free: 0, ...overrides });

describe("stockBadge", () => {
  it("reads a line with no Odoo product as Not linked to Odoo", () => {
    expect(stockBadge({ quantity: 5, product: null }))
      .toMatchObject({ kind: STOCK_BADGE.NOT_LINKED, label: "Not linked to Odoo" });
  });

  it("reads a service/consumable as Not tracked regardless of quantity", () => {
    expect(
      stockBadge({ quantity: 5, product: { type: "service", free: 0 } }),
    ).toMatchObject({ kind: STOCK_BADGE.NOT_TRACKED, label: "Not tracked" });
  });

  it("reads free stock at or above quantity as Available", () => {
    expect(
      stockBadge({ quantity: 10, product: trackedProduct({ free: 10 }) }),
    ).toMatchObject({ kind: STOCK_BADGE.AVAILABLE, label: "Available", free: 10 });

    expect(
      stockBadge({ quantity: 10, product: trackedProduct({ free: 15 }) }),
    ).toMatchObject({ kind: STOCK_BADGE.AVAILABLE });
  });

  it("reads free stock above zero but below quantity as Partial, with the exact figures", () => {
    expect(
      stockBadge({ quantity: 10, product: trackedProduct({ free: 6 }) }),
    ).toMatchObject({ kind: STOCK_BADGE.PARTIAL, label: "Partial · 6 of 10", free: 6 });
  });

  it("reads zero free stock as Out of stock", () => {
    expect(
      stockBadge({ quantity: 10, product: trackedProduct({ free: 0 }) }),
    ).toMatchObject({ kind: STOCK_BADGE.OUT_OF_STOCK, label: "Out of stock", free: 0 });
  });

  it("reads negative free stock as Out of stock, not a crash", () => {
    expect(
      stockBadge({ quantity: 10, product: trackedProduct({ free: -3 }) }),
    ).toMatchObject({ kind: STOCK_BADGE.OUT_OF_STOCK, free: -3 });
  });

  it("handles a fractional quantity", () => {
    expect(
      stockBadge({ quantity: 2.5, product: trackedProduct({ free: 2 }) }),
    ).toMatchObject({ kind: STOCK_BADGE.PARTIAL, label: "Partial · 2 of 2.5" });
  });
});
