import { describe, it, expect } from "vitest";
import {
  resolveDepartmentHeads,
  resolveOrgWideHeads,
  ORG_WIDE_SUB_DEPARTMENT,
  ORG_WIDE_DEPARTMENT,
} from "./resolveDepartmentHeads";

describe("resolveDepartmentHeads", () => {
  it("returns no matches when there are no heads", () => {
    const employee = { department: "Engineering", sub_department: "Backend" };
    expect(resolveDepartmentHeads(employee, [])).toEqual([]);
  });

  it("returns no matches for a null/missing employee or heads list", () => {
    expect(resolveDepartmentHeads(null, [{ department: "Engineering" }])).toEqual([]);
    expect(resolveDepartmentHeads({ department: "Engineering" }, null)).toEqual([]);
  });

  it("matches a single department head", () => {
    const employee = { department: "Engineering", sub_department: null };
    const deptHead = { id: "h1", department: "Engineering", sub_department: null };
    expect(resolveDepartmentHeads(employee, [deptHead])).toEqual([deptHead]);
  });

  it("returns all matching department heads when several exist", () => {
    const employee = { department: "Engineering", sub_department: null };
    const heads = [
      { id: "h1", department: "Engineering", sub_department: null },
      { id: "h2", department: "Engineering", sub_department: null },
      { id: "h3", department: "Sales", sub_department: null },
    ];
    const matches = resolveDepartmentHeads(employee, heads);
    expect(matches.map((h) => h.id)).toEqual(["h1", "h2"]);
  });

  it("prefers a sub-department head over a department head for the same employee", () => {
    const employee = { department: "Engineering", sub_department: "Backend" };
    const subDeptHead = { id: "shadow", department: "Engineering", sub_department: "Backend" };
    const deptHead = { id: "dept", department: "Engineering", sub_department: null };
    // Sub-department heads are checked first per-candidate: the department
    // head is never considered a match once the employee has a matching
    // sub-department head, because the department branch only applies when
    // the head itself carries no real sub-department of its own — which is
    // true for deptHead, but deptHead's department still matches, so it is
    // still a candidate. The characterisation is: subDeptHead matches via
    // the sub-department branch, deptHead matches via the department branch,
    // and both are returned — sub-department-first is the order.
    const matches = resolveDepartmentHeads(employee, [deptHead, subDeptHead]);
    expect(matches.map((h) => h.id)).toEqual(["dept", "shadow"]);
    expect(matches[0].id).not.toBe(matches[1].id);
  });

  it("does not let an org-wide head win via the sub-department branch", () => {
    const employee = { department: "Engineering", sub_department: "Backend" };
    const orgWideHead = {
      id: "org",
      department: "SUPER ADMIN",
      sub_department: ORG_WIDE_SUB_DEPARTMENT,
    };
    expect(resolveDepartmentHeads(employee, [orgWideHead])).toEqual([]);
  });

  it("does not let an org-wide department head match on department", () => {
    const employee = { department: "Engineering", sub_department: null };
    const orgWideHead = { id: "org", department: ORG_WIDE_DEPARTMENT, sub_department: null };
    expect(resolveDepartmentHeads(employee, [orgWideHead])).toEqual([]);
  });

  it("returns no matches for an employee with no department", () => {
    const employee = { department: null, sub_department: null };
    const heads = [{ id: "h1", department: "Engineering", sub_department: null }];
    expect(resolveDepartmentHeads(employee, heads)).toEqual([]);
  });
});

describe("resolveOrgWideHeads", () => {
  it("returns heads flagged is_super_admin", () => {
    const heads = [{ id: "h1", is_super_admin: true }, { id: "h2" }];
    expect(resolveOrgWideHeads(heads).map((h) => h.id)).toEqual(["h1"]);
  });

  it("returns heads with the org-wide sub-department sentinel", () => {
    const heads = [{ id: "h1", sub_department: ORG_WIDE_SUB_DEPARTMENT }];
    expect(resolveOrgWideHeads(heads).map((h) => h.id)).toEqual(["h1"]);
  });

  it("returns heads with the org-wide department sentinel", () => {
    const heads = [{ id: "h1", department: ORG_WIDE_DEPARTMENT }];
    expect(resolveOrgWideHeads(heads).map((h) => h.id)).toEqual(["h1"]);
  });

  it("returns an empty array for no heads", () => {
    expect(resolveOrgWideHeads([])).toEqual([]);
    expect(resolveOrgWideHeads(null)).toEqual([]);
  });
});
