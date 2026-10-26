import { describe, expect, it } from "vitest";
import { costComparisonText } from "./costComparison";

describe("costComparisonText", () => {
  it("marks a Canvass winner's price as the expected cost when no P0 is attached", () => {
    expect(costComparisonText({ expected: 100, actual: null, fromCanvass: true })).toBe("₱100.00 (Canvass winner)");
  });
  it("says nothing extra for a typed Acquire with no P0", () => {
    expect(costComparisonText({ expected: 100, actual: null })).toBeNull();
    expect(costComparisonText({ expected: null, actual: undefined })).toBeNull();
  });
  it("shows Expected, Actual and the change when the P0 price differs", () => {
    expect(costComparisonText({ expected: 100, actual: 120, fromCanvass: true })).toBe("Expected ₱100.00 · Actual ₱120.00 (+20.0%)");
    expect(costComparisonText({ expected: 200, actual: 150 })).toBe("Expected ₱200.00 · Actual ₱150.00 (-25.0%)");
  });
  it("shows one figure when both agree, or when there is no expected cost", () => {
    expect(costComparisonText({ expected: 100, actual: 100, fromCanvass: true })).toBe("₱100.00");
    expect(costComparisonText({ expected: null, actual: 80 })).toBe("₱80.00");
  });
});
