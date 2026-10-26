import { describe, it, expect } from "vitest";
import { groupTaskEvaluatorId, isGroupTaskEvaluator } from "./groupTaskEvaluator";

describe("groupTaskEvaluatorId", () => {
  it("is the evaluator when the task names one", () => {
    expect(groupTaskEvaluatorId({ created_by: "creator", evaluator_id: "owner" })).toBe("owner");
  });

  it("falls back to the creator when there is no evaluator", () => {
    expect(groupTaskEvaluatorId({ created_by: "creator", evaluator_id: null })).toBe("creator");
    expect(groupTaskEvaluatorId({ created_by: "creator" })).toBe("creator");
  });

  it("is null for no task", () => {
    expect(groupTaskEvaluatorId(null)).toBeNull();
  });
});

describe("isGroupTaskEvaluator", () => {
  const stageTask = { created_by: "creator", evaluator_id: "owner" };

  it("is true for the evaluator and false for the creator of a stage task", () => {
    expect(isGroupTaskEvaluator(stageTask, "owner")).toBe(true);
    expect(isGroupTaskEvaluator(stageTask, "creator")).toBe(false);
  });

  it("is the creator on a task with no evaluator", () => {
    expect(isGroupTaskEvaluator({ created_by: "creator" }, "creator")).toBe(true);
  });

  it("is false when nobody is signed in", () => {
    expect(isGroupTaskEvaluator({ created_by: undefined }, undefined)).toBe(false);
  });
});
