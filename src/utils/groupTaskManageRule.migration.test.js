import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

const sql = readFileSync(
  new URL("../../supabase/migrations/20261102110000_group_task_manage_rule.sql", import.meta.url),
  "utf8",
);

describe("group task manage rule migration (#656)", () => {
  it("defines the role check as head, HR or Super Admin", () => {
    expect(sql).toMatch(/FUNCTION public\.can_manage_group_tasks\(\)/);
    expect(sql).toMatch(/e\.is_head or e\.is_hr or e\.is_super_admin/);
  });

  it("gates committee_tasks inserts on the check, with a Stage Action exemption", () => {
    const policy = sql.slice(
      sql.indexOf('create policy "committee_tasks_insert"'),
      sql.indexOf('create policy "committee_task_members_insert"'),
    );
    expect(policy).toMatch(/can_manage_group_tasks\(\)/);
    expect(policy).toMatch(/group_task_is_stage_action\(stage_action_id, opportunity_id\)/);
    expect(policy).toMatch(/created_by = public\.get_employee_id\(\)/);
  });

  it("gates member inserts the same way", () => {
    const policy = sql.slice(sql.indexOf('create policy "committee_task_members_insert"'));
    expect(policy).toMatch(/can_manage_group_tasks\(\)/);
    expect(policy).toMatch(/group_task_is_stage_action/);
  });
});
