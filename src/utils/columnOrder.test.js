import { describe, expect, it } from "vitest";

import { cellsInOrder, shownColumns } from "./columnOrder";

const COLUMNS = [
  { key: "number", locked: true },
  { key: "status" },
  { key: "date" },
];

describe("shownColumns", () => {
  it("keeps the list's order and drops the columns the picker hides", () => {
    const hidden = ["status"];
    expect(shownColumns(COLUMNS, (key) => !hidden.includes(key)).map((c) => c.key)).toEqual(["number", "date"]);
  });

  it("always shows a locked column", () => {
    expect(shownColumns(COLUMNS, () => false).map((c) => c.key)).toEqual(["number"]);
  });

  it("shows every column when no picker is given", () => {
    expect(shownColumns(COLUMNS).map((c) => c.key)).toEqual(["number", "status", "date"]);
  });
});

describe("cellsInOrder", () => {
  // Written out of order on purpose: the list decides the order, not the map.
  const cells = {
    date: () => "Nov 18",
    number: () => "IPAS-1",
    status: () => "Paid",
  };
  const drawn = (columns) => cellsInOrder(columns, cells).map((cell) => [cell.key, cell.props.children]);

  it("draws the cells in the list's order, each keyed by its column", () => {
    expect(drawn(COLUMNS)).toEqual([
      ["number", "IPAS-1"],
      ["status", "Paid"],
      ["date", "Nov 18"],
    ]);
  });

  it("draws only the columns given, and nothing for a key with no cell", () => {
    expect(drawn([{ key: "status" }, { key: "unknown" }])).toEqual([
      ["status", "Paid"],
      ["unknown", null],
    ]);
  });
});
