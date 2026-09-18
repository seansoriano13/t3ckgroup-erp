import { describe, it, expect } from "vitest";

import {
  accessWindowSummary,
  describeSelector,
  initialsOf,
  stageAudience,
} from "./stageAudience";
import { CONDITION_KINDS } from "../constants/stageGate";

const EMPLOYEES = [
  { id: "e1", name: "Maria Daniella C. Duran", sub_department: "SALES" },
  { id: "e2", name: "Raquel Galacgac", sub_department: "PURCHASING" },
  { id: "e3", name: "Cjay Espina", sub_department: "PURCHASING" },
  { id: "gone", name: "Left Already", is_deleted: true },
];

const GROUPS_BY_ID = { g1: { id: "g1", name: "Purchasing" } };
const GROUP_MEMBERS = { g1: { employeeIds: ["e2", "e3"] } };
const STAGE_NAMES = { s2: "Negotiation", s3: "Delivery" };

const groupTask = (overrides = {}) => ({
  kind: "create_group_task",
  config: {
    title: "PMS – Evaluation",
    members: [{ employeeId: "e1" }, { employeeId: "e2" }],
    ...overrides,
  },
});

const base = (overrides = {}) => ({
  employees: EMPLOYEES,
  groupMembersById: GROUP_MEMBERS,
  groupsById: GROUPS_BY_ID,
  stageNameById: STAGE_NAMES,
  ...overrides,
});

describe("accessWindowSummary", () => {
  it("says a default window reaches this Stage only", () => {
    expect(accessWindowSummary(undefined, STAGE_NAMES)).toMatchObject({
      rule: "stage_left",
      ruleLabel: "Only this Stage",
      reachLabel: "this Stage only",
      fellBack: false,
    });
  });

  // The two rules that used to be one word apart ("is entered" / "is left")
  // now differ in shape, and each names the end Stage in the label itself.
  it("labels the span rather than the closing event", () => {
    expect(
      accessWindowSummary({ until: "later_stage_left", stageId: "s3" }, STAGE_NAMES).ruleLabel,
    ).toBe("This Stage, through Delivery");
    expect(
      accessWindowSummary({ until: "stage_entered", stageId: "s3" }, STAGE_NAMES).ruleLabel,
    ).toBe("This Stage, until Delivery begins");
    expect(accessWindowSummary({ until: "terminal" }, STAGE_NAMES).ruleLabel).toBe(
      "The rest of the deal",
    );
  });

  // The consequence the rule name never stated: a window that closes later
  // also opens every Stage on the way there.
  it("spells out that a later-Stage window reaches the Stages in between", () => {
    expect(
      accessWindowSummary({ until: "later_stage_left", stageId: "s3" }, STAGE_NAMES).helperLabel,
    ).toBe(
      "Every Stage the deal passes through between here and Delivery, including Delivery itself.",
    );
    expect(
      accessWindowSummary({ until: "stage_entered", stageId: "s2" }, STAGE_NAMES).helperLabel,
    ).toBe(
      "Every Stage the deal passes through between here and Negotiation — but not Negotiation itself.",
    );
  });

  it("keeps the roster's reach phrase short enough to read as one line", () => {
    expect(
      accessWindowSummary({ until: "later_stage_left", stageId: "s3" }, STAGE_NAMES).reachLabel,
    ).toBe("this Stage, through Delivery");
    expect(accessWindowSummary({ until: "terminal" }, STAGE_NAMES).reachLabel).toBe(
      "this Stage and every Stage after it",
    );
  });

  it("reports the fallback the database will apply when the end Stage is gone", () => {
    expect(accessWindowSummary({ until: "later_stage_left", stageId: "deleted" }, STAGE_NAMES))
      .toMatchObject({ reachLabel: "this Stage only", fellBack: true });
  });

  it("treats an unknown rule as the default rather than throwing", () => {
    expect(accessWindowSummary({ until: "whenever" }, STAGE_NAMES).rule).toBe("stage_left");
  });
});

describe("initialsOf", () => {
  it("takes the first and last name, never a middle initial", () => {
    expect(initialsOf("Maria Daniella C. Duran")).toBe("MD");
    expect(initialsOf("Raquel Galacgac")).toBe("RG");
  });

  it("handles one name and no name", () => {
    expect(initialsOf("Cher")).toBe("CH");
    expect(initialsOf("")).toBe("??");
    expect(initialsOf(undefined)).toBe("??");
  });
});

describe("describeSelector", () => {
  it("names a person, a group, a Team and a role", () => {
    const context = { employees: EMPLOYEES, groupsById: GROUPS_BY_ID };
    expect(describeSelector({ type: "employee", id: "e1" }, context)).toBe(
      "Maria Daniella C. Duran",
    );
    expect(describeSelector({ type: "group", id: "g1" }, context)).toBe("Purchasing");
    expect(describeSelector({ type: "team", team: "purchasing" }, context)).toBe(
      "Everyone in PURCHASING",
    );
    expect(describeSelector({ type: "role", role: "sales_director" }, context)).toBe(
      "Sales Director",
    );
  });
});

describe("stageAudience", () => {
  it("answers Deal Team only when nothing calls anyone in", () => {
    const audience = stageAudience(base());
    expect(audience.calledIn).toEqual([]);
    expect(audience.isRestricted).toBe(false);
    expect(audience.counts.seeingRoles).toBe(audience.dealTeam.length);
  });

  it("names an action's assignees, with the action that called them in", () => {
    const audience = stageAudience(base({ actions: [groupTask()] }));

    expect(audience.calledIn.map((p) => p.name)).toEqual([
      "Maria Daniella C. Duran",
      "Raquel Galacgac",
    ]);
    expect(audience.calledIn[0].calls).toEqual([
      expect.objectContaining({ kind: "action", label: "PMS – Evaluation" }),
    ]);
    expect(audience.counts.calledIn).toBe(2);
  });

  it("resolves an Assignment condition's group into the people it names", () => {
    const audience = stageAudience(
      base({
        conditions: [
          {
            kind: CONDITION_KINDS.ASSIGNMENT,
            config: { who: [{ type: "group", id: "g1" }], access: { until: "terminal" } },
          },
        ],
      }),
    );

    expect(audience.calledIn.map((p) => p.name)).toEqual(["Cjay Espina", "Raquel Galacgac"]);
    expect(audience.calledIn[0].calls[0]).toMatchObject({
      kind: "condition",
      label: "Assignment condition",
      window: { reachLabel: "this Stage and every Stage after it" },
    });
  });

  // sor_stage_participants opens a row per call-in, so two calls are two
  // windows. Collapsing them here would understate the access granted.
  it("keeps one line per call when two actions name the same person", () => {
    const audience = stageAudience(
      base({
        actions: [
          groupTask({ title: "Evaluation of Specifications", members: [{ employeeId: "e1" }] }),
          groupTask({
            title: "PMS – Evaluation",
            members: [{ employeeId: "e1" }],
            access: { until: "terminal" },
          }),
        ],
      }),
    );

    expect(audience.calledIn).toHaveLength(1);
    expect(audience.calledIn[0].calls.map((c) => c.label)).toEqual([
      "Evaluation of Specifications",
      "PMS – Evaluation",
    ]);
    expect(audience.calledIn[0].calls[1].window.reachLabel).toBe(
      "this Stage and every Stage after it",
    );
  });

  it("marks shut-out roles and counts the people an excluded group removes", () => {
    const audience = stageAudience(
      base({
        stageAccess: { shutOutRoles: ["sales_director"], excludedGroupIds: ["g1"] },
      }),
    );

    expect(audience.dealTeam.find((r) => r.role === "sales_director").shutOut).toBe(true);
    expect(audience.counts.shutOutRoles).toBe(1);
    expect(audience.shutOutGroups).toEqual([
      { id: "g1", name: "Purchasing", memberCount: 2 },
    ]);
    expect(audience.counts.shutOutPeople).toBe(2);
    expect(audience.isRestricted).toBe(true);
  });

  it("carries the Flow's Always sees list through by name", () => {
    const audience = stageAudience(
      base({ flowAccess: { alwaysSees: [{ type: "group", id: "g1" }] } }),
    );
    expect(audience.alwaysSees).toEqual([{ key: "group:g1", label: "Purchasing" }]);
  });

  it("names a departed employee rather than dropping the call-in silently", () => {
    const audience = stageAudience(
      base({ actions: [groupTask({ members: [{ employeeId: "nobody" }] })] }),
    );
    expect(audience.calledIn[0].name).toBe("Former employee");
  });

  it("ignores an action with no assignees and a non-Assignment condition", () => {
    const audience = stageAudience(
      base({
        actions: [groupTask({ members: [] })],
        conditions: [{ kind: CONDITION_KINDS.ATTACHMENT, config: { who: [] } }],
      }),
    );
    expect(audience.calledIn).toEqual([]);
  });
});
