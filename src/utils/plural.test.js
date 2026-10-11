import { describe, expect, it } from "vitest";
import { pluralize } from "./plural";

describe("pluralize", () => {
  it("uses the singular for exactly one", () => {
    expect(pluralize(1, "task")).toBe("1 task");
  });
  it("pluralises zero and many", () => {
    expect(pluralize(0, "task")).toBe("0 tasks");
    expect(pluralize(3, "day")).toBe("3 days");
  });
  it("accepts an irregular plural", () => {
    expect(pluralize(2, "entry", "entries")).toBe("2 entries");
  });
});
