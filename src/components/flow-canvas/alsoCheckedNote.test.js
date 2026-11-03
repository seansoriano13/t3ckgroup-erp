import { describe, it, expect } from "vitest";
import { alsoCheckedNote } from "./flowStageKinds";

const stages = [
  { id: "a", name: "Alpha" },
  { id: "b", name: "Beta" },
  { id: "c", name: "Gamma" },
];

describe("alsoCheckedNote", () => {
  it("is null when the kind sits on one Stage only", () => {
    const by = { a: [{ kind: "purchasing_settled" }], b: [{ kind: "tickbox" }] };
    expect(alsoCheckedNote(by.a[0], "a", by, stages)).toBeNull();
  });

  it("names every other Stage that has the kind", () => {
    const by = { a: [{ kind: "x" }], b: [{ kind: "x" }], c: [{ kind: "x" }] };
    expect(alsoCheckedNote(by.a[0], "a", by, stages)).toBe("Also checked at Stages Beta, Gamma");
    expect(alsoCheckedNote(by.b[0], "b", { a: by.a, b: by.b }, stages)).toBe("Also checked at Stage Alpha");
  });
});
