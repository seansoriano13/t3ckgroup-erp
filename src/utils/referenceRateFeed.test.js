import { describe, it, expect } from "vitest";
import { feedSource, feedUrl, readFeedRate } from "../../supabase/functions/_shared/referenceRateFeed.ts";

describe("readFeedRate", () => {
  it("reads PHP per unit under the feed's own date, not today's", () => {
    expect(readFeedRate({ amount: 1, base: "USD", date: "2026-10-16", rates: { PHP: 58.2 } }, "USD")).toEqual({
      currency: "USD",
      rateDate: "2026-10-16",
      phpPerUnit: 58.2,
    });
  });

  it("refuses an answer for another currency", () => {
    expect(() => readFeedRate({ base: "EUR", date: "2026-10-16", rates: { PHP: 66 } }, "USD")).toThrow(/USD/);
  });

  it.each([
    [{ base: "USD", date: "2026-10-16", rates: {} }],
    [{ base: "USD", date: "2026-10-16", rates: { PHP: 0 } }],
    [{ base: "USD", date: "2026-10-16", rates: { PHP: "58" } }],
    [{ base: "USD", rates: { PHP: 58 } }],
    [{ base: "USD", date: "16 Oct", rates: { PHP: 58 } }],
    [null],
  ])("refuses a broken answer rather than writing zero or a guessed date (%#)", (body) => {
    expect(() => readFeedRate(body, "USD")).toThrow();
  });
});

describe("feedUrl", () => {
  it("asks for one currency against PHP", () => {
    expect(feedUrl("eur")).toBe("https://api.frankfurter.dev/v1/latest?base=EUR&symbols=PHP");
  });
});

describe("BSP for US dollars (#1212)", () => {
  it("asks BSP for USD and the ECB for every other currency", () => {
    expect(feedUrl("usd")).toBe("https://api.frankfurter.dev/v2/rate/USD/PHP?providers=BSP");
    expect(feedSource("USD")).toBe("BSP via frankfurter.dev");
    expect(feedSource("eur")).toBe("ECB via frankfurter.dev");
  });

  it("reads the BSP single-rate answer under its own date", () => {
    expect(readFeedRate({ date: "2026-11-23", base: "USD", quote: "PHP", rate: 63.8 }, "USD")).toEqual({
      currency: "USD",
      rateDate: "2026-11-23",
      phpPerUnit: 63.8,
    });
  });
});
