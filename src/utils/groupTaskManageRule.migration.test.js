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

describe("group task edit/delete guard migration (#656 follow-up)", () => {
  const guard = readFileSync(
    new URL("../../supabase/migrations/20261102120000_group_task_manage_edit_delete.sql", import.meta.url),
    "utf8",
  );

  it("guards detail columns and manual cancels on update", () => {
    expect(guard).toMatch(/before update on public\.committee_tasks/);
    expect(guard).toMatch(/new\.title is distinct from old\.title/);
    expect(guard).toMatch(/can_manage_group_tasks\(\)/);
    expect(guard).toMatch(/group_task_is_stage_action/);
    expect(guard).toMatch(/new\.status = .CANCELLED./);
  });

  it("limits deletes on tasks and members to managers", () => {
    expect(guard).toMatch(/"committee_tasks_delete"[\s\S]*using \(public\.can_manage_group_tasks\(\)\)/);
    expect(guard).toMatch(/"committee_task_members_delete"[\s\S]*using \(public\.can_manage_group_tasks\(\)\)/);
  });
});
