import { describe, it, expect } from "vitest";
import { idsForUpdateMode, canUpdateSorVersion, isOutdatedSor, revertTargets, UPDATE_MODE } from "./sorVersionUpdate";

describe("idsForUpdateMode", () => {
  const all = ["a", "b", "c"];
  it("all ignores the picks", () => expect(idsForUpdateMode(UPDATE_MODE.ALL, all, ["a"])).toEqual(all));
  it("only takes exactly the picks", () => expect(idsForUpdateMode(UPDATE_MODE.ONLY, all, ["b"])).toEqual(["b"]));
  it("all but leaves the picks out", () =>
    expect(idsForUpdateMode(UPDATE_MODE.ALL_BUT, all, ["b"])).toEqual(["a", "c"]));
});

describe("canUpdateSorVersion", () => {
  const sor = { deal_owner_id: "owner" };
  it("lets a Super Admin update any SOR", () =>
    expect(canUpdateSorVersion({ actor: { id: "x", is_super_admin: true }, sor, batchSize: 5 })).toBe(true));
  it("lets a head update their own department only", () => {
    const head = { id: "h", is_head: true, department: "SALES" };
    expect(canUpdateSorVersion({ actor: head, sor, sorDepartment: "SALES", batchSize: 5 })).toBe(true);
    expect(canUpdateSorVersion({ actor: head, sor, sorDepartment: "OPERATIONS", batchSize: 5 })).toBe(false);
  });
  it("lets the Deal Team update one at a time only", () => {
    const actor = { id: "owner" };
    expect(canUpdateSorVersion({ actor, sor, batchSize: 1 })).toBe(true);
    expect(canUpdateSorVersion({ actor, sor, batchSize: 2 })).toBe(false);
  });
  it("refuses everyone else", () => expect(canUpdateSorVersion({ actor: { id: "z" }, sor })).toBe(false));
});

describe("outdated and revert", () => {
  it("is outdated only when pinned to a non-latest snapshot", () => {
    expect(isOutdatedSor({ sale_type_id: "t", flow_snapshot_id: "s1" }, "s2")).toBe(true);
    expect(isOutdatedSor({ sale_type_id: "t", flow_snapshot_id: "s2" }, "s2")).toBe(false);
    expect(isOutdatedSor({ flow_snapshot_id: "s1" }, "s2")).toBe(false);
  });
  it("offers only versions that keep the Stage", () => {
    const snaps = [
      { id: "a", snapshot_data: { stages: [{ id: "st" }] } },
      { id: "b", snapshot_data: { stages: [{ id: "other" }] } },
      { id: "cur", snapshot_data: { stages: [{ id: "st" }] } },
    ];
    expect(revertTargets(snaps, { flow_snapshot_id: "cur", flow_stage_id: "st" }).map((s) => s.id)).toEqual(["a"]);
  });
});
