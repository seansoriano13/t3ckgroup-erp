import { describe, it, expect } from "vitest";
import { canvasAccessLens, stageCalledInSelectors, stageHasAccessNote } from "./canvasAccessLens";
import { CONDITION_KINDS } from "../constants/stageGate";

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
    expect(lens.s2).toBe("deal-team");
  });

  it("does not hide a role not named in shutOutRoles", () => {
    const draft = { stages: [{ id: "s1", shutOutRoles: ["support_sales"] }] };
    const lens = canvasAccessLens({ snapshotLikeDraft: draft, selector: { type: "role", role: "deal_owner" } });
    expect(lens.s1).toBe("deal-team");
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

  it("gives a colleague outside the excluded group no access unless named on the flow", () => {
    const draft = {
      stages: [{ id: "s1", excludedGroupIds: ["g1"] }],
      employees,
      groupMembersById: { g1: { employeeIds: ["emp-outsider"] } },
    };
    const lens = canvasAccessLens({ snapshotLikeDraft: draft, selector: { type: "employee", id: "emp-support" } });
    expect(lens.s1).toBe("hidden");
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
    expect(lens.s1).toBe("hidden");
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

describe("canvasAccessLens with Always sees / Always edits", () => {
  const draft = ({ alwaysSees = [], alwaysEdits = [] }) => ({
    stages: [{ id: "s1", shutOutRoles: ["support_sales"] }, { id: "s2" }],
    employees,
    groupMembersById: { g1: { employeeIds: ["emp-owner"] } },
    alwaysSees,
    alwaysEdits,
  })
  const asEmployee = (id) => ({ type: "employee", id })

  it("still hides a Restricted Stage from a shut-out role when Always sees is Everyone", () => {
    const lens = canvasAccessLens({
      snapshotLikeDraft: draft({ alwaysSees: [{ type: "everyone" }] }),
      selector: { type: "role", role: "support_sales" },
    })
    expect(lens.s1).toBe("hidden")
    expect(lens.s2).toBe("deal-team")
  })

  it("reads Everyone in both lists as can-edit (Legacy Pipeline)", () => {
    const lens = canvasAccessLens({
      snapshotLikeDraft: draft({ alwaysSees: [{ type: "everyone" }], alwaysEdits: [{ type: "everyone" }] }),
      selector: asEmployee("emp-outsider"),
    })
    expect(lens).toEqual({ s1: "can-edit", s2: "can-edit" })
  })

  it("reads Always sees alone as view-only", () => {
    const lens = canvasAccessLens({
      snapshotLikeDraft: draft({ alwaysSees: [asEmployee("emp-owner")] }),
      selector: asEmployee("emp-owner"),
    })
    expect(lens.s2).toBe("view-only")
  })

  it("lets Always edits imply view", () => {
    const lens = canvasAccessLens({
      snapshotLikeDraft: draft({ alwaysEdits: [asEmployee("emp-owner")] }),
      selector: asEmployee("emp-owner"),
    })
    expect(lens.s2).toBe("can-edit")
  })

  it("resolves Always sees through a group the employee belongs to", () => {
    const lens = canvasAccessLens({
      snapshotLikeDraft: draft({ alwaysSees: [{ type: "group", id: "g1" }] }),
      selector: asEmployee("emp-owner"),
    })
    expect(lens.s2).toBe("view-only")
  })

  it("shuts Always sees out of a Restricted Stage for an excluded group", () => {
    const d = draft({ alwaysSees: [{ type: "group", id: "g1" }] })
    d.stages[0].excludedGroupIds = ["g1"]
    const lens = canvasAccessLens({ snapshotLikeDraft: d, selector: asEmployee("emp-owner") })
    expect(lens.s1).toBe("hidden")
    expect(lens.s2).toBe("view-only")
  })

  it("gives someone named nowhere no access", () => {
    const lens = canvasAccessLens({
      snapshotLikeDraft: draft({ alwaysSees: [asEmployee("emp-owner")] }),
      selector: asEmployee("emp-outsider"),
    })
    expect(lens).toEqual({ s1: "hidden", s2: "hidden" })
  })
})

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

describe("stageCalledInSelectors", () => {
  it("returns nothing for no conditions and no actions", () => {
    expect(stageCalledInSelectors([], [])).toEqual([]);
    expect(stageCalledInSelectors()).toEqual([]);
  });

  it("collects an Assignment condition's who selectors", () => {
    const conditions = [
      {
        kind: CONDITION_KINDS.ASSIGNMENT,
        config: { who: [{ type: "role", role: "deal_owner" }, { type: "group", id: "g1" }] },
      },
    ];
    expect(stageCalledInSelectors(conditions, [])).toEqual([
      { type: "role", role: "deal_owner" },
      { type: "group", id: "g1" },
    ]);
  });

  it("ignores a non-Assignment condition's config", () => {
    const conditions = [{ kind: CONDITION_KINDS.TICKBOX, config: { who: [{ type: "role", role: "deal_owner" }] } }];
    expect(stageCalledInSelectors(conditions, [])).toEqual([]);
  });

  it("turns every action member into an employee selector", () => {
    const actions = [
      { config: { members: [{ employeeId: "emp-1" }, { employeeId: "emp-2", role: "Reviewer" }] } },
      { config: { members: [{ employeeId: "emp-3" }] } },
    ];
    expect(stageCalledInSelectors([], actions)).toEqual([
      { type: "employee", id: "emp-1" },
      { type: "employee", id: "emp-2" },
      { type: "employee", id: "emp-3" },
    ]);
  });

  it("skips a member with no employeeId", () => {
    const actions = [{ config: { members: [{ role: "Reviewer" }] } }];
    expect(stageCalledInSelectors([], actions)).toEqual([]);
  });

  it("combines conditions and actions in order", () => {
    const conditions = [{ kind: CONDITION_KINDS.ASSIGNMENT, config: { who: [{ type: "employee", id: "emp-1" }] } }];
    const actions = [{ config: { members: [{ employeeId: "emp-2" }] } }];
    expect(stageCalledInSelectors(conditions, actions)).toEqual([
      { type: "employee", id: "emp-1" },
      { type: "employee", id: "emp-2" },
    ]);
  });
});
