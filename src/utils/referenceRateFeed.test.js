import { describe, it, expect } from "vitest";
import { feedUrl, readFeedRate } from "../../supabase/functions/_shared/referenceRateFeed.ts";

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
    expect(feedUrl("usd")).toBe("https://api.frankfurter.dev/v1/latest?base=USD&symbols=PHP");
  });
});
