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

import { describe as d2, it as it2, expect as ex2 } from "vitest"
import { addedActionsForStage, describeAction, summariseAddedActions, isForwardUpdate } from "./sorVersionUpdate"

d2("version update Stage Actions (#846)", () => {
  const snap = (version, actions) => ({ version, version_minor: 0, snapshot_data: { actions } })
  const a = (id, stage_id) => ({ id, stage_id, kind: "create_group_task" })
  it2("runs only actions added to the current Stage", () => {
    const source = snap(1, [a("1", "s1")])
    const target = snap(2, [a("1", "s1"), a("2", "s1"), a("3", "s0")])
    ex2(addedActionsForStage({ source, target, stageId: "s1" }).map((x) => x.id)).toEqual(["2"])
  })
  it2("runs nothing going back", () => {
    const source = snap(2, [])
    const target = snap(1, [a("2", "s1")])
    ex2(isForwardUpdate(source, target)).toBe(false)
    ex2(addedActionsForStage({ source, target, stageId: "s1" })).toEqual([])
  })
  it2("summarises one line per action", () => {
    const x = a("2", "s1")
    ex2(summariseAddedActions([{ action: x, name: "Site" }, { action: x, name: "Site" }])[0].text).toBe("2 deals will get: Site")
  })
})

d2("describeAction (#846)", () => {
  it2("names a task by its own title", () => {
    ex2(describeAction({ kind: "create_group_task", config: { title: "Site survey" } })).toBe("Group Task 'Site survey'")
  })
  it2("says who a purchasing Action notifies", () => {
    ex2(describeAction({ kind: "open_purchase_request", config: {} })).toBe("Open Purchase Request; notify Purchasing")
  })
  it2("says a confirm Action only asks", () => {
    ex2(describeAction({ kind: "create_group_task", config: { title: "X", confirmMode: "confirm" } })).toContain("asks its Decider")
  })
})
