import { describe, it, expect } from "vitest";
import { activeGroupKey } from "./navSection";

const groups = [
  { key: "workspace", links: [{ link: "/", exactMatch: true }, { link: "/calendar" }] },
  { key: "approvals", links: [{ link: "/approvals/leaves" }] },
  { key: "human_resources", links: [{ link: "/hr/management" }, { link: "/hr/offsets" }] },
];

describe("activeGroupKey", () => {
  it("finds the group that holds the current page", () => {
    expect(activeGroupKey(groups, "/hr/management")).toBe("human_resources");
    expect(activeGroupKey(groups, "/hr/offsets/")).toBe("human_resources");
    expect(activeGroupKey(groups, "/approvals/leaves")).toBe("approvals");
  });

  it("matches the Dashboard only on the exact path", () => {
    expect(activeGroupKey(groups, "/")).toBe("workspace");
    expect(activeGroupKey(groups, "/nowhere")).toBeNull();
  });
});
