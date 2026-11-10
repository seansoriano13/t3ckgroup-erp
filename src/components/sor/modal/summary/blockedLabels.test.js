import { describe, expect, it } from "vitest";
import { blockedLabels } from "./shared";

describe("blockedLabels (#791)", () => {
  const checklist = [
    { condition: { is_required: true, label: "Quote sent" }, status: "unsatisfied" },
    { condition: { is_required: true, label: "Done" }, status: "satisfied" },
    { condition: { is_required: false, label: "Optional" }, status: "unsatisfied" },
  ];

  it("counts unsatisfied required conditions and missing required stage fields together", () => {
    expect(blockedLabels(checklist, [{ label: "PO number" }])).toEqual(["Quote sent", "PO number"]);
  });

  it("works with conditions only", () => {
    expect(blockedLabels(checklist)).toEqual(["Quote sent"]);
  });
});
