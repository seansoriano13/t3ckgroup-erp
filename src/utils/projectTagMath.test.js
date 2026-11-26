import { describe, expect, it } from "vitest";
import {
  analyticIds,
  mentionsS0,
  parseDistributionKey,
  percentForS0,
  planColumnFromFields,
  s0FromTagName,
  sharesFromDistribution,
} from "../../supabase/functions/_shared/projectTagMath.ts";

const names = new Map([
  [101, "S01111 Alpha Project"],
  [102, "S02222 Beta Project"],
  [9, "Marketing Dept"],
]);

describe("parseDistributionKey / analyticIds", () => {
  it("splits a joined key and drops junk", () => {
    expect(parseDistributionKey("101,9")).toEqual([101, 9]);
    expect(parseDistributionKey("x,0,-3,7")).toEqual([7]);
  });
  it("collects unique ids across keys", () => {
    expect(analyticIds({ 101: 50, "101,9": 50, 102: 10 })).toEqual([101, 102, 9]);
    expect(analyticIds(null)).toEqual([]);
  });
});

describe("S0 matching", () => {
  it("is whole-word", () => {
    expect(mentionsS0("S06637 - Internal Transfer", "S06637")).toBe(true);
    expect(mentionsS0("S06637 - Internal Transfer", "S0663")).toBe(false);
    expect(mentionsS0("Ref: S0663, S06637", "S0663")).toBe(true);
    expect(mentionsS0("", "S0663")).toBe(false);
    expect(mentionsS0("S0663", "bad")).toBe(false);
  });
  it("reads the S0 from a tag name", () => {
    expect(s0FromTagName("S01111 Alpha Project")).toBe("S01111");
    expect(s0FromTagName("Marketing Dept")).toBeNull();
  });
});

describe("shares", () => {
  it("gives each split project its own percent", () => {
    const shares = sharesFromDistribution({ 101: 60, 102: 40 }, names);
    expect(percentForS0(shares, "S01111")).toBe(60);
    expect(percentForS0(shares, "S02222")).toBe(40);
    expect(percentForS0(shares, "S09999")).toBe(0);
  });
  it("counts a joined key's percent for the project in it", () => {
    const shares = sharesFromDistribution({ "101,9": 100 }, names);
    expect(percentForS0(shares, "S01111")).toBe(100);
    expect(shares.find((s) => s.tagId === 9)).toMatchObject({ s0: null, percent: 100 });
  });
});

describe("planColumnFromFields", () => {
  it("prefers the custom plan column, falls back to account_id", () => {
    expect(planColumnFromFields(["account_id", "x_plan5_id"], 5)).toBe("x_plan5_id");
    expect(planColumnFromFields(["account_id"], 5)).toBe("account_id");
    expect(planColumnFromFields([], 5)).toBeNull();
  });
});
