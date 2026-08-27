import { describe, expect, it } from "vitest"

import { REQUIREMENT_KINDS } from "../../constants/stageGate"
import {
  ACTION_KIND_META,
  REQUIREMENT_KIND_META,
  actionSummary,
  actionTitle,
  requirementDetail,
} from "./flowStageKinds"

describe("flowStageKinds", () => {
  it("names every kind the database will accept", () => {
    for (const kind of Object.values(REQUIREMENT_KINDS)) {
      expect(REQUIREMENT_KIND_META[kind]?.label).toBeTruthy()
    }
    // Mirrors flow_stage_actions_kind_chk (migration 0053).
    expect(Object.keys(ACTION_KIND_META).sort()).toEqual([
      "create_group_task",
      "create_individual_task",
    ])
  })

  describe("actionTitle", () => {
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
  })

  describe("requirementDetail", () => {
    it("surfaces the column a field requirement watches", () => {
      expect(
        requirementDetail({ kind: REQUIREMENT_KINDS.FIELD, config: { column: "po_date" } }),
      ).toBe("po_date")
    })

    it("says what an unconfigured attachment or assignment actually accepts", () => {
      expect(requirementDetail({ kind: REQUIREMENT_KINDS.ATTACHMENT, config: {} })).toBe(
        "Any document",
      )
      expect(requirementDetail({ kind: REQUIREMENT_KINDS.ASSIGNMENT, config: {} })).toBe("Anyone")
    })

    it("pluralises a deadline and refuses a nonsensical one", () => {
      expect(requirementDetail({ kind: REQUIREMENT_KINDS.DEADLINE, config: { days: 1 } })).toBe(
        "1 day",
      )
      expect(requirementDetail({ kind: REQUIREMENT_KINDS.DEADLINE, config: { days: 10 } })).toBe(
        "10 days",
      )
      expect(requirementDetail({ kind: REQUIREMENT_KINDS.DEADLINE, config: { days: 0 } })).toBeNull()
    })

    it("has nothing to add for a tickbox", () => {
      expect(requirementDetail({ kind: REQUIREMENT_KINDS.TICKBOX, config: {} })).toBeNull()
    })

    // Issue #50.
    it("surfaces a Project Evaluation requirement's optional reference link", () => {
      expect(
        requirementDetail({
          kind: REQUIREMENT_KINDS.PROJECT_EVALUATION,
          config: { referenceLink: "https://example.com/template" },
        }),
      ).toBe("https://example.com/template")
      expect(
        requirementDetail({ kind: REQUIREMENT_KINDS.PROJECT_EVALUATION, config: {} }),
      ).toBeNull()
    })
  })
})
