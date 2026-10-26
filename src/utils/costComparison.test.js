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
  it("treats a PHP P0 as pesos, as quoted", () => {
    expect(costComparisonText({ expected: 100, actual: 120, quoted: 120, currency: "PHP" })).toBe("Expected ₱100.00 · Actual ₱120.00 (+20.0%)");
  });
  it("shows a foreign P0 in pesos at the Canvass rate, with its own price beside it", () => {
    // P01235: the Light Tower 400 at USD 388, Canvass winner at 63.509.
    expect(costComparisonText({ expected: 24641.49, actual: 24641.49, quoted: 388, currency: "USD", fromCanvass: true })).toBe("₱24,641.49 · $388.00 at the Canvass rate");
    expect(costComparisonText({ expected: 24641.49, actual: 25276.58, quoted: 398, currency: "USD" })).toBe("Expected ₱24,641.49 · Actual ₱25,276.58 (+2.6%) · $398.00 at the Canvass rate");
  });
  it("never sets a foreign P0 with no peso Actual against a peso figure", () => {
    const text = costComparisonText({ expected: 24641.49, actual: null, quoted: 388, currency: "USD", fromCanvass: true });
    expect(text).toBe("Expected ₱24,641.49 · Actual $388.00 in USD, not compared: no USD Canvass winner to turn it into pesos");
    expect(text).not.toMatch(/₱388|%/);
    expect(costComparisonText({ expected: null, actual: null, quoted: 388, currency: "USD" })).toBe("Actual $388.00 in USD, not compared: no USD Canvass winner to turn it into pesos");
  });
});
