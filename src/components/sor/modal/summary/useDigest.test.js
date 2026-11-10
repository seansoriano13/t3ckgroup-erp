import { describe, expect, it } from "vitest";
import { pendingDecisionAttention } from "./useDigest";

describe("pendingDecisionAttention (#901)", () => {
  it("lists each Stage Action waiting on Create or Skip under Needs attention, linked to the Now tab", () => {
    const rows = pendingDecisionAttention([{ runId: "run-1", title: "S00462 · Rope rescue", failed: false }]);

    expect(rows).toEqual([
      {
        key: "decision-run-1",
        tone: "amber",
        text: "S00462 · Rope rescue is waiting for your Create or Skip.",
        go: "now",
      },
    ]);
  });

  it("says a failed Create can be pressed again", () => {
    const [row] = pendingDecisionAttention([{ runId: "run-2", title: "Approve pricing", failed: true }]);

    expect(row.text).toBe("Approve pricing failed. Press Create to try again.");
    expect(row.go).toBe("now");
  });

  it("falls back to a plain name when the action has no title", () => {
    const [row] = pendingDecisionAttention([{ runId: "run-3", title: "", failed: false }]);

    expect(row.text).toBe("A Stage Action is waiting for your Create or Skip.");
  });

  it("returns nothing when no decision is waiting", () => {
    expect(pendingDecisionAttention([])).toEqual([]);
    expect(pendingDecisionAttention()).toEqual([]);
  });
});
