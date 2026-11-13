import { describe, expect, it } from "vitest";
import { CANVASS_STATE } from "./canvassStatus";
import { buildCanvassGrid, canUnlockLine, cellLiner, formatAmount, pickAllBlockedReason, pickBlockedReason } from "./canvassGrid";

const item = (id, over = {}) => ({ id, name: `Line ${id}`, quantity: 2, unit: "pc", status: "to_purchase", ...over });
const supplier = (id, over = {}) => ({ id, supplier_name: `Supplier ${id}`, currency: "PHP", comparison_rate: null, ...over });
const quote = (supplierId, itemId, over = {}) => ({
  id: `${supplierId}-${itemId}`,
  supplier_id: supplierId,
  item_id: itemId,
  unit_price: 100,
  php_figure: 100,
  ...over,
});
const canvass = (over = {}) => ({
  canReadMoney: true,
  suppliers: [],
  quotes: [],
  winners: [],
  noOtherSupplier: null,
  ...over,
});

describe("buildCanvassGrid", () => {
  it("has one row per line, a cancelled one too, and one column per supplier, in order", () => {
    const grid = buildCanvassGrid({
      items: [item("a"), item("b"), item("c", { status: "cancelled" })],
      canvass: canvass({ suppliers: [supplier("s1"), supplier("s2")] }),
    });
    expect(grid.lines.map((l) => l.id)).toEqual(["a", "b", "c"]);
    expect(grid.lines.map((l) => l.cancelled)).toEqual([false, false, true]);
    expect(grid.strip.lineCount).toBe(2);
    expect(grid.suppliers.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(grid.lines[0].cells.map((c) => c.supplierId)).toEqual(["s1", "s2"]);
  });

  it("draws an empty grid when no supplier has been added yet", () => {
    const grid = buildCanvassGrid({ items: [item("a")], canvass: null });
    expect(grid.suppliers).toEqual([]);
    expect(grid.lines).toHaveLength(1);
    expect(grid.lines[0].cells).toEqual([]);
    expect(grid.strip.suppliersText).toBe("0 of 3 suppliers");
    expect(grid.covered).toBe(false);
  });

  it("treats a place with no quote as 'did not quote'", () => {
    const grid = buildCanvassGrid({
      items: [item("a")],
      canvass: canvass({ suppliers: [supplier("s1"), supplier("s2")], quotes: [quote("s1", "a")] }),
    });
    const [first, second] = grid.lines[0].cells;
    expect(first.quoted).toBe(true);
    expect(second.quoted).toBe(false);
    expect(second.total).toBeNull();
    expect(grid.lines[0].quotedCount).toBe(1);
  });

  it("works the total out as price times quantity, to the centavo", () => {
    const grid = buildCanvassGrid({
      items: [item("a", { quantity: 3 })],
      canvass: canvass({ suppliers: [supplier("s1")], quotes: [quote("s1", "a", { unit_price: 10.1, php_figure: 10.1 })] }),
    });
    expect(grid.lines[0].cells[0].total).toBe(30.3);
  });

  it("leaves the total blank while the price is blank, never zero", () => {
    const grid = buildCanvassGrid({
      items: [item("a")],
      canvass: canvass({ suppliers: [supplier("s1")], quotes: [quote("s1", "a", { unit_price: null, php_figure: null })] }),
    });
    expect(grid.lines[0].cells[0].total).toBeNull();
  });

  describe("the cheapest quote", () => {
    const usd = supplier("s3", { currency: "USD", comparison_rate: 50 });

    it("is the lowest PHP figure on the line, compared in PHP", () => {
      const grid = buildCanvassGrid({
        items: [item("a")],
        canvass: canvass({
          suppliers: [supplier("s1"), supplier("s2"), usd],
          quotes: [
            quote("s1", "a", { unit_price: 5000, php_figure: 5000 }),
            quote("s2", "a", { unit_price: 4800, php_figure: 4800 }),
            // 90 USD x 50 is 4,500 PHP: cheaper than either PHP quote though 90 < 4,800 says nothing alone.
            quote("s3", "a", { unit_price: 90, php_figure: 4500 }),
          ],
        }),
      });
      expect(grid.lines[0].cells.map((c) => c.cheapest)).toEqual([false, false, true]);
    });

    it("marks every quote that ties for the lowest", () => {
      const grid = buildCanvassGrid({
        items: [item("a")],
        canvass: canvass({
          suppliers: [supplier("s1"), supplier("s2"), supplier("s3")],
          quotes: [quote("s1", "a"), quote("s2", "a"), quote("s3", "a", { unit_price: 200, php_figure: 200 })],
        }),
      });
      expect(grid.lines[0].cells.map((c) => c.cheapest)).toEqual([true, true, false]);
    });

    it("marks nothing when only one quote has a price, or a foreign quote has no rate", () => {
      const grid = buildCanvassGrid({
        items: [item("a")],
        canvass: canvass({
          suppliers: [supplier("s1"), usd],
          quotes: [quote("s1", "a"), quote("s3", "a", { unit_price: 1, php_figure: null })],
        }),
      });
      expect(grid.lines[0].cells.map((c) => c.cheapest)).toEqual([false, false]);
    });
  });

  describe("winners and line states", () => {
    const suppliers = [supplier("s1"), supplier("s2"), supplier("s3")];
    const all = (itemId) => suppliers.map((s) => quote(s.id, itemId));

    it("names each line's winner and reason, and marks the winning cell", () => {
      const grid = buildCanvassGrid({
        items: [item("a"), item("b")],
        canvass: canvass({
          suppliers,
          quotes: [...all("a"), ...all("b")],
          winners: [{ item_id: "a", supplier_id: "s2", reason: "Holds stock." }],
        }),
      });
      const [a, b] = grid.lines;
      expect(a.winner).toMatchObject({ supplierId: "s2", reason: "Holds stock." });
      expect(a.winner.supplier.name).toBe("Supplier s2");
      expect(a.cells.map((c) => c.winner)).toEqual([false, true, false]);
      expect(a.state).toBe(CANVASS_STATE.WINNER_PICKED);
      expect(b.winner).toBeNull();
      expect(b.state).toBe(CANVASS_STATE.NEEDS_WINNER);
    });

    it("counts the header strip: suppliers of three, lines with a winner, the note", () => {
      const grid = buildCanvassGrid({
        items: [item("a"), item("b"), item("c")],
        canvass: canvass({
          suppliers: suppliers.slice(0, 2),
          quotes: [quote("s1", "a")],
          winners: [{ item_id: "a", supplier_id: "s1", reason: "Only one" }],
          noOtherSupplier: { reason: "Sole distributor", actor_id: "e1" },
        }),
      });
      expect(grid.strip).toMatchObject({
        suppliersText: "2 of 3 suppliers",
        linesText: "1 of 3 lines have a winner",
        winnerCount: 1,
        lineCount: 3,
      });
      expect(grid.strip.note.reason).toBe("Sole distributor");
      expect(grid.covered).toBe(true);
    });

    it("says 'line has' for a single line", () => {
      const grid = buildCanvassGrid({ items: [item("a")], canvass: canvass({ suppliers }) });
      expect(grid.strip.linesText).toBe("0 of 1 line has a winner");
    });

    it("needs suppliers until three are there or a note covers them", () => {
      const two = buildCanvassGrid({ items: [item("a")], canvass: canvass({ suppliers: suppliers.slice(0, 2) }) });
      expect(two.covered).toBe(false);
      expect(two.lines[0].state).toBe(CANVASS_STATE.NEEDS_SUPPLIERS);
      expect(two.state).toBe(CANVASS_STATE.NEEDS_SUPPLIERS);
      const three = buildCanvassGrid({ items: [item("a")], canvass: canvass({ suppliers }) });
      expect(three.covered).toBe(true);
    });

    it("locks a Purchased line, until a Super Admin has unlocked it", () => {
      const items = [item("a", { status: "purchased" })];
      const locked = buildCanvassGrid({ items, canvass: canvass({ suppliers }) });
      expect(locked.lines[0]).toMatchObject({ locked: true, state: CANVASS_STATE.LOCKED });
      const open = buildCanvassGrid({ items, canvass: canvass({ suppliers }), unlockedIds: new Set(["a"]) });
      expect(open.lines[0]).toMatchObject({ locked: false, unlocked: true });
    });
  });

  describe("a reader who may not see money", () => {
    const grid = buildCanvassGrid({
      items: [item("a")],
      canvass: {
        canReadMoney: false,
        // The service leaves the money keys off altogether for this reader.
        suppliers: [{ id: "s1", supplier_name: "Redleaf", currency: "USD" }, { id: "s2", supplier_name: "Ferno", currency: "PHP" }],
        quotes: [{ id: "q1", supplier_id: "s1", item_id: "a", brand: "Redleaf" }, { id: "q2", supplier_id: "s2", item_id: "a", brand: "Ferno" }],
        winners: [],
        noOtherSupplier: null,
      },
    });

    it("works out no total, figure, rate or cheapest mark", () => {
      expect(grid.canReadMoney).toBe(false);
      expect(grid.suppliers[0]).toMatchObject({ rate: null, rateMissing: false });
      for (const cell of grid.lines[0].cells) {
        expect(cell).toMatchObject({ unitPrice: null, total: null, phpFigure: null, cheapest: false, quoted: true });
      }
    });
  });
});

describe("supplier columns", () => {
  it("carries the currency, the rate where money shows, and flags a foreign supplier with no rate", () => {
    const grid = buildCanvassGrid({
      items: [item("a")],
      canvass: canvass({
        suppliers: [supplier("s1"), supplier("s2", { currency: "USD", comparison_rate: 56.5 }), supplier("s3", { currency: "EUR", comparison_rate: null, expired: true })],
      }),
    });
    const [php, usd, eur] = grid.suppliers;
    expect(php).toMatchObject({ currency: "PHP", foreign: false, rateMissing: false });
    expect(usd).toMatchObject({ currency: "USD", foreign: true, rate: 56.5, rateMissing: false });
    expect(eur).toMatchObject({ rateMissing: true, expired: true });
  });
});

describe("pickBlockedReason", () => {
  const suppliers = [supplier("s1"), supplier("s2"), supplier("s3")];
  const build = (over = {}, items = [item("a")]) =>
    buildCanvassGrid({ items, canvass: canvass({ suppliers, quotes: [quote("s1", "a")], ...over }) });

  it("allows a pick on a quoted, open line once the Canvass is covered", () => {
    const grid = build();
    expect(pickBlockedReason(grid, grid.lines[0], grid.lines[0].cells[0])).toBeNull();
  });

  it("refuses without three suppliers or a note, and names what is needed", () => {
    const grid = build({ suppliers: suppliers.slice(0, 2) });
    expect(pickBlockedReason(grid, grid.lines[0], grid.lines[0].cells[0])).toMatch(/3 suppliers, or a "No other supplier" note/);
  });

  it("is allowed with a note covering the missing suppliers", () => {
    const grid = build({ suppliers: suppliers.slice(0, 1), noOtherSupplier: { reason: "Sole distributor" } });
    expect(pickBlockedReason(grid, grid.lines[0], grid.lines[0].cells[0])).toBeNull();
  });

  it("refuses a supplier that did not quote the line", () => {
    const grid = build();
    expect(pickBlockedReason(grid, grid.lines[0], grid.lines[0].cells[1])).toMatch(/did not quote/);
  });

  it("refuses a locked line", () => {
    const grid = build({}, [item("a", { status: "purchased" })]);
    expect(pickBlockedReason(grid, grid.lines[0], grid.lines[0].cells[0])).toMatch(/Purchased/);
  });
});

describe("pickAllBlockedReason", () => {
  it("is off until covered, and off for a supplier with nothing it can win", () => {
    const suppliers = [supplier("s1"), supplier("s2"), supplier("s3")];
    const two = buildCanvassGrid({ items: [item("a")], canvass: canvass({ suppliers: suppliers.slice(0, 2), quotes: [quote("s1", "a")] }) });
    expect(pickAllBlockedReason(two, "s1")).toMatch(/3 suppliers/);
    const three = buildCanvassGrid({ items: [item("a")], canvass: canvass({ suppliers, quotes: [quote("s1", "a")] }) });
    expect(pickAllBlockedReason(three, "s1")).toBeNull();
    expect(pickAllBlockedReason(three, "s2")).toMatch(/no line it can win/);
  });
});

describe("formatAmount", () => {
  it("writes PHP with the peso sign and other currencies with their code", () => {
    expect(formatAmount(78000)).toBe("₱78,000.00");
    expect(formatAmount(1280.5, "usd")).toBe("USD 1,280.50");
  });

  it("writes a blank as a dash, never zero", () => {
    expect(formatAmount(null)).toBe("—");
    expect(formatAmount("")).toBe("—");
    expect(formatAmount(0)).toBe("₱0.00");
  });
});

describe("small helpers", () => {
  it("lets only a Super Admin unlock a locked line", () => {
    const locked = { locked: true };
    expect(canUnlockLine(locked, true)).toBe(true);
    expect(canUnlockLine(locked, false)).toBe(false);
    expect(canUnlockLine({ locked: false }, true)).toBe(false);
  });

  it("joins brand, description and remarks into one line", () => {
    expect(cellLiner({ quote: { brand: "Redleaf", description: " Folding ", remarks: "" } })).toBe("Redleaf · Folding");
    expect(cellLiner({ quote: null })).toBe("");
  });
});
