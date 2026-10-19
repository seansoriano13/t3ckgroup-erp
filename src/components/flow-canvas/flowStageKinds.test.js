import { describe, expect, it } from "vitest"

import { CONDITION_KINDS } from "../../constants/stageGate"
import {
  ACTION_KIND_META,
  CONDITION_KIND_META,
  actionSummary,
  actionTitle,
  conditionDetail,
  fieldDetail,
  fieldMeta,
} from "./flowStageKinds"

describe("flowStageKinds", () => {
  // Issue #203: field and project_evaluation are removed kinds — the
  // database's check constraint still accepts them (so old rows stay
  // valid), but the picker's meta no longer names them.
  const REMOVED_KINDS = [CONDITION_KINDS.FIELD, CONDITION_KINDS.PROJECT_EVALUATION]

  it("names every kind still offered from the picker", () => {
    for (const kind of Object.values(CONDITION_KINDS)) {
      if (REMOVED_KINDS.includes(kind)) {
        expect(CONDITION_KIND_META[kind]).toBeUndefined()
        continue
      }
      expect(CONDITION_KIND_META[kind]?.label).toBeTruthy()
    }
    // Mirrors flow_stage_actions_kind_chk (migration 0053).
    expect(Object.keys(ACTION_KIND_META).sort()).toEqual([
      "create_group_task",
      "create_individual_task",
      "open_costing_matrix",
      "open_purchase_request",
      "request_packing_list",
    ])
  })

  describe("actionTitle", () => {
    it("names a Request Packing List, which carries no title", () => {
      expect(actionTitle({ kind: "request_packing_list", config: {} })).toBe("Request Packing List")
    })

    it("names an Open Costing Matrix, which carries no title", () => {
      expect(actionTitle({ kind: "open_costing_matrix", config: {} })).toBe("Open Costing Matrix")
    })

    it("names an Open Purchase Request, which carries no title", () => {
      expect(actionTitle({ kind: "open_purchase_request", config: {} })).toBe("Open Purchase Request")
    })

    it("reads a group task's own title", () => {
      expect(actionTitle({ kind: "create_group_task", config: { title: "Prepare bid docs" } }))
        .toBe("Prepare bid docs")
    })

    it("reads an individual task's projectTitle", () => {
      // The bug this covers: an individual-task automation stores its name as
      // `projectTitle`, so reading only `config.title` labelled every one of
      // them "Untitled action".
      expect(
        actionTitle({
          kind: "create_individual_task",
          config: { projectTitle: "Chase the signatory" },
        }),
      ).toBe("Chase the signatory")
    })

    it("falls back rather than rendering an empty row", () => {
      expect(actionTitle({ kind: "create_group_task", config: {} })).toBe("Untitled action")
      expect(actionTitle({ kind: "create_group_task", config: { title: "   " } })).toBe(
        "Untitled action",
      )
      expect(actionTitle(null)).toBe("Untitled action")
    })
  })

  describe("actionSummary", () => {
    it("counts a group task's assignees", () => {
      expect(
        actionSummary({
          kind: "create_group_task",
          config: { members: [{ employeeId: "a" }, { employeeId: "b" }] },
        }),
      ).toBe("Group Task · 2 assignees")
    })

    it("says the kind alone when a group task has nobody on it yet", () => {
      expect(actionSummary({ kind: "create_group_task", config: {} })).toBe("Group Task")
    })

    it("reports an individual task's priority", () => {
      expect(
        actionSummary({ kind: "create_individual_task", config: { priority: "HIGH" } }),
      ).toBe("Individual Task · high priority")
    })

    it("says who a Request Packing List tells: the Warehouse list, or the people named", () => {
      expect(actionSummary({ kind: "request_packing_list", config: {} })).toBe(
        "Request Packing List · tells the Warehouse list",
      )
      expect(
        actionSummary(
          { kind: "request_packing_list", config: { notify: [{ type: "employee", id: "p-1" }] } },
          { employees: [{ id: "p-1", name: "Pia Reyes" }] },
        ),
      ).toBe("Request Packing List · tells Pia Reyes")
    })

    it("names the Purchasing Incharge an Open Costing Matrix will set, or says there is none", () => {
      const employees = [{ id: "p-1", name: "Raquel Dela Cruz" }]
      expect(
        actionSummary(
          { kind: "open_costing_matrix", config: { purchasingIncharge: { type: "employee", id: "p-1" } } },
          { employees },
        ),
      ).toBe("Open Costing Matrix · Purchasing: Raquel Dela Cruz")
      expect(actionSummary({ kind: "open_costing_matrix", config: {} })).toBe(
        "Open Costing Matrix · no Purchasing Incharge named",
      )
    })

    // Issue #411 — a single-employee Decider was always rendered as "the
    // assignee", even for an employee who wasn't the action's own assignee.
    describe("a single-employee Decider", () => {
      const employees = [
        { id: "decider-1", name: "Ana Reyes" },
        { id: "assignee-1", name: "Ben Cruz" },
      ]

      it("names the employee when they aren't the action's assignee", () => {
        expect(
          actionSummary(
            {
              kind: "create_individual_task",
              config: {
                confirmMode: "confirm",
                loggedById: "assignee-1",
                decider: [{ type: "employee", id: "decider-1" }],
              },
            },
            { employees },
          ),
        ).toBe("Individual Task · When confirmed · Ana Reyes decides")
      })

      it("says \"the assignee\" only when the Decider really is the assignee", () => {
        expect(
          actionSummary(
            {
              kind: "create_individual_task",
              config: {
                confirmMode: "confirm",
                loggedById: "assignee-1",
                decider: [{ type: "employee", id: "assignee-1" }],
              },
            },
            { employees },
          ),
        ).toBe("Individual Task · When confirmed · the assignee decides")
      })

      it("falls back to \"the assignee\" for an employee no longer listed", () => {
        expect(
          actionSummary(
            {
              kind: "create_individual_task",
              config: { confirmMode: "confirm", decider: [{ type: "employee", id: "gone" }] },
            },
            { employees },
          ),
        ).toBe("Individual Task · When confirmed · the assignee decides")
      })
    })
  })

  describe("conditionDetail", () => {
    it("has nothing to add for a removed field condition", () => {
      expect(
        conditionDetail({ kind: CONDITION_KINDS.FIELD, config: { column: "po_date" } }),
      ).toBeNull()
    })

    it("says what an unconfigured attachment or assignment actually accepts", () => {
      expect(conditionDetail({ kind: CONDITION_KINDS.ATTACHMENT, config: {} })).toBe("Any")
      expect(conditionDetail({ kind: CONDITION_KINDS.ASSIGNMENT, config: {} })).toBe("Anyone")
    })

    it("names the Accepts groups for an attachment condition (issue #203)", () => {
      expect(
        conditionDetail({ kind: CONDITION_KINDS.ATTACHMENT, config: { accepts: ["pdf", "image"] } }),
      ).toBe("PDF, Images")
    })

    it("names an Employee Group or Team in an assignment condition's who", () => {
      expect(
        conditionDetail({
          kind: CONDITION_KINDS.ASSIGNMENT,
          config: { who: [{ type: "group", id: "grp-1", label: "Purchasing" }] },
        }),
      ).toBe("Purchasing (group)")
    })

    it("pluralises a deadline and refuses a nonsensical one", () => {
      expect(conditionDetail({ kind: CONDITION_KINDS.DEADLINE, config: { days: 1 } })).toBe(
        "1 day",
      )
      expect(conditionDetail({ kind: CONDITION_KINDS.DEADLINE, config: { days: 10 } })).toBe(
        "10 days",
      )
      expect(conditionDetail({ kind: CONDITION_KINDS.DEADLINE, config: { days: 0 } })).toBeNull()
    })

    it("has nothing to add for a tickbox", () => {
      expect(conditionDetail({ kind: CONDITION_KINDS.TICKBOX, config: {} })).toBeNull()
    })

    // Issue #203: Project Evaluation is a removed kind — no meta, no detail.
    it("has nothing to add for a removed kind", () => {
      expect(
        conditionDetail({ kind: CONDITION_KINDS.PROJECT_EVALUATION, config: {} }),
      ).toBeNull()
    })
  })

  describe("fieldDetail", () => {
    it("names an SOR field by the SOR field it writes to, and says a required one blocks leaving", () => {
      expect(
        fieldDetail({ source: "sor", sor_field: "expected_award_date", is_required: true }),
      ).toBe("SOR field · Expected Award Date · blocks leaving")
    })

    it("names a custom field by its input type", () => {
      expect(fieldDetail({ source: "custom", field_type: "choice", is_required: false })).toBe("Choice")
      expect(fieldDetail({ source: "custom", field_type: "number", is_required: true })).toBe(
        "Number · blocks leaving",
      )
    })

    it("falls back to the raw key for an SOR field it has no label for", () => {
      expect(fieldDetail({ source: "sor", sor_field: "gone_field", is_required: false })).toBe(
        "SOR field · gone_field",
      )
    })
  })

  describe("fieldMeta", () => {
    it("gives every kind of field an icon and a label", () => {
      for (const field of [
        { source: "sor" },
        { source: "custom", field_type: "text" },
        { source: "custom", field_type: "number" },
        { source: "custom", field_type: "date" },
        { source: "custom", field_type: "choice" },
        { source: "custom", field_type: "something_new" },
      ]) {
        expect(fieldMeta(field).label).toBeTruthy()
        expect(fieldMeta(field).icon).toBeTruthy()
      }
    })
  })
})
