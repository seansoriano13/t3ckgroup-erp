import { describe, it, expect } from "vitest";
import { canvasAccessLens, stageHasAccessNote } from "./canvasAccessLens";

const employees = [
  { id: "emp-owner", sub_department: "NGO" },
  { id: "emp-support", sub_department: "NGO" },
  { id: "emp-outsider", sub_department: "LOGISTICS" },
];

describe("canvasAccessLens", () => {
  it("marks every stage visible when there is no restriction and no selector", () => {
    const draft = { stages: [{ id: "s1" }, { id: "s2" }] };
    expect(canvasAccessLens({ snapshotLikeDraft: draft, selector: null })).toEqual({
      s1: "visible",
      s2: "visible",
    });
  });

  it("hides a stage from a role selector it shuts out", () => {
    const draft = {
      stages: [
        { id: "s1", shutOutRoles: ["support_sales"] },
        { id: "s2", shutOutRoles: [] },
      ],
    };
    const lens = canvasAccessLens({ snapshotLikeDraft: draft, selector: { type: "role", role: "support_sales" } });
    expect(lens.s1).toBe("hidden");
    expect(lens.s2).toBe("visible");
  });

  it("does not hide a role not named in shutOutRoles", () => {
    const draft = { stages: [{ id: "s1", shutOutRoles: ["support_sales"] }] };
    const lens = canvasAccessLens({ snapshotLikeDraft: draft, selector: { type: "role", role: "deal_owner" } });
    expect(lens.s1).toBe("visible");
  });

  it("hides a stage from a group selector it excludes", () => {
    const draft = { stages: [{ id: "s1", excludedGroupIds: ["g1"] }] };
    const lens = canvasAccessLens({ snapshotLikeDraft: draft, selector: { type: "group", id: "g1" } });
    expect(lens.s1).toBe("hidden");
  });

  it("hides a stage from an employee who resolves into an excluded group by hand-picked membership", () => {
    const draft = {
      stages: [{ id: "s1", excludedGroupIds: ["g1"] }],
      employees,
      groupMembersById: { g1: { employeeIds: ["emp-outsider"] } },
    };
    const lens = canvasAccessLens({ snapshotLikeDraft: draft, selector: { type: "employee", id: "emp-outsider" } });
    expect(lens.s1).toBe("hidden");
  });

  it("hides a stage from an employee who resolves into an excluded group by team", () => {
    const draft = {
      stages: [{ id: "s1", excludedGroupIds: ["g1"] }],
      employees,
      groupMembersById: { g1: { teams: ["LOGISTICS"] } },
    };
    const lens = canvasAccessLens({ snapshotLikeDraft: draft, selector: { type: "employee", id: "emp-outsider" } });
    expect(lens.s1).toBe("hidden");
  });

  it("leaves a same-role colleague outside the excluded group visible", () => {
    const draft = {
      stages: [{ id: "s1", excludedGroupIds: ["g1"] }],
      employees,
      groupMembersById: { g1: { employeeIds: ["emp-outsider"] } },
    };
    const lens = canvasAccessLens({ snapshotLikeDraft: draft, selector: { type: "employee", id: "emp-support" } });
    expect(lens.s1).toBe("visible");
  });

  it("marks a stage calls-in for a role it explicitly calls, even when that role is also shut out", () => {
    const draft = {
      stages: [
        {
          id: "s1",
          shutOutRoles: ["support_sales"],
          calledIn: [{ type: "role", role: "support_sales" }],
        },
      ],
    };
    const lens = canvasAccessLens({ snapshotLikeDraft: draft, selector: { type: "role", role: "support_sales" } });
    expect(lens.s1).toBe("calls-in");
  });

  it("marks a stage calls-in for an employee named directly", () => {
    const draft = {
      stages: [{ id: "s1", calledIn: [{ type: "employee", id: "emp-owner" }] }],
    };
    const lens = canvasAccessLens({ snapshotLikeDraft: draft, selector: { type: "employee", id: "emp-owner" } });
    expect(lens.s1).toBe("calls-in");
  });

  it("marks a stage calls-in for an employee called in via a group", () => {
    const draft = {
      stages: [{ id: "s1", calledIn: [{ type: "group", id: "g1" }] }],
      employees,
      groupMembersById: { g1: { employeeIds: ["emp-owner"] } },
    };
    const lens = canvasAccessLens({ snapshotLikeDraft: draft, selector: { type: "employee", id: "emp-owner" } });
    expect(lens.s1).toBe("calls-in");
  });

  it("does not call in an employee not covered by the calling group", () => {
    const draft = {
      stages: [{ id: "s1", calledIn: [{ type: "group", id: "g1" }] }],
      employees,
      groupMembersById: { g1: { employeeIds: ["emp-owner"] } },
    };
    const lens = canvasAccessLens({ snapshotLikeDraft: draft, selector: { type: "employee", id: "emp-support" } });
    expect(lens.s1).toBe("visible");
  });

  it("ignores stages with no id", () => {
    const draft = { stages: [{ name: "no id" }, { id: "s1" }] };
    const lens = canvasAccessLens({ snapshotLikeDraft: draft, selector: { type: "role", role: "deal_owner" } });
    expect(Object.keys(lens)).toEqual(["s1"]);
  });

  it("defaults missing stages/selector to an empty lens", () => {
    expect(canvasAccessLens({})).toEqual({});
    expect(canvasAccessLens()).toEqual({});
  });
});

describe("stageHasAccessNote", () => {
  it("is false for a stage with no restriction and no call-in", () => {
    expect(stageHasAccessNote({ id: "s1" })).toBe(false);
  });

  it("is true when a role is shut out", () => {
    expect(stageHasAccessNote({ shutOutRoles: ["deal_owner"] })).toBe(true);
  });

  it("is true when a group is excluded", () => {
    expect(stageHasAccessNote({ excludedGroupIds: ["g1"] })).toBe(true);
  });

  it("is true when the stage calls someone in", () => {
    expect(stageHasAccessNote({ calledIn: [{ type: "role", role: "deal_owner" }] })).toBe(true);
  });

  it("is false for a falsy stage", () => {
    expect(stageHasAccessNote(null)).toBe(false);
  });
});
