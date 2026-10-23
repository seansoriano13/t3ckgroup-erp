import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

const sql = readFileSync(
  new URL("../../supabase/migrations/20261102130000_657_convert_task_to_group_task.sql", import.meta.url),
  "utf8",
);

describe("convert task to Group Task migration (#657)", () => {
  it("is security definer and refuses non-managers first", () => {
    expect(sql).toMatch(/function public\.convert_task_to_group_task/);
    expect(sql).toMatch(/security definer/);
    expect(sql).toMatch(/not public\.can_manage_group_tasks\(\)/);
  });

  it("refuses Stage Action and submitted/approved/cancelled tasks", () => {
    expect(sql).toMatch(/v_task\.stage_action_id is not null/);
    for (const status of ["AWAITING APPROVAL", "COMPLETED", "DELETED", "CANCELLED"]) {
      expect(sql).toContain(`'${status}'`);
    }
  });

  it("carries the chat history, repoints notifications and logs the audit row", () => {
    expect(sql).toMatch(/insert into public\.committee_task_activity[\s\S]*from public\.task_activity/);
    expect(sql).toMatch(/update public\.notifications/);
    expect(sql).toMatch(/GROUP_TASK_REACTION/);
    expect(sql).toMatch(/insert into public\.system_audit_logs/);
  });

  it("is not callable by anon", () => {
    expect(sql).toMatch(/revoke all on function public\.convert_task_to_group_task\(uuid, uuid\[\]\) from public, anon/);
  });
});
