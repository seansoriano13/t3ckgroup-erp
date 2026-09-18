import { supabase } from "../lib/supabase";
import { systemAuditLogService } from "./systemAuditLogService";

async function prepareEmailForSave(email, currentEmployeeId = null) {
  if (!email) return null;
  const cleanEmail = email.trim();
  let query = supabase
    .from("employees")
    .select("id, email, is_deleted")
    .eq("email", cleanEmail);

  if (currentEmployeeId) {
    query = query.neq("id", currentEmployeeId);
  }

  const { data: existingRows, error } = await query;
  if (error) {
    throw new Error("Unable to verify if email is already in use. Please try again.");
  }
  if (!existingRows || existingRows.length === 0) {
    return cleanEmail;
  }

  const activeExisting = existingRows.find((row) => !row.is_deleted);
  if (activeExisting) {
    throw new Error(`An active employee with the email "${cleanEmail}" already exists.`);
  }

  // If we found rows with this exact email that are soft-deleted, archive their email so the new active employee can be created cleanly
  const deletedExisting = existingRows.filter((row) => row.is_deleted);
  for (const delEmp of deletedExisting) {
    const baseEmail = delEmp.email?.split("#deleted_")[0] || delEmp.email;
    const archivedEmail = `${baseEmail}#deleted_${Date.now()}_${delEmp.id.toString().slice(0, 4)}`;
    await supabase
      .from("employees")
      .update({
        email: archivedEmail,
        updated_at: new Date().toISOString(),
      })
      .eq("id", delEmp.id);
  }

  return cleanEmail;
}

export const employeeService = {
  async getEmployeeByEmail(email) {
    const { data, error } = await supabase
      .from("employees")
      .select("*, company:companies(id, name)")
      .eq("email", email)
      .neq("is_deleted", true)
      .single();

    if (error) return null;

    return {
      id: data.id,
      email: data.email,
      name: data.name,
      department: data.department,
      subDepartment: data.sub_department,
      role: data.role,
      isHead: data.is_head,
      isHr: data.is_hr,
      isSuperAdmin: data.is_super_admin,
      isRoleSimulator: data.is_role_simulator,
      isIssuedPassword: !!data.is_issued_password,
      hiddenNavKeys: data.hidden_nav_keys || [],
      canManageLeaves: data.can_manage_leaves,
      signaturePath: data.signature_path || null,
      avatarPath: data.avatar_path || null,
      dashboardBannerPath: data.dashboard_banner_path || null,
      dashboardQuote: data.dashboard_quote || null,
      has_sales_flow: data.has_sales_flow,
      has_task_flow: data.has_task_flow,
      // Coerced: a frontend running ahead of 0054 gets undefined from `select("*")`,
      // and the flag grants nothing until a Super Admin turns it on anyway.
      has_purchasing_flow: !!data.has_purchasing_flow,
      offset_hours_balance: data.offset_hours_balance || 0,
      employment_status: data.employment_status || null,
      sil_hours_balance: data.sil_hours_balance || 0,
      companyId: data.company_id || null,
      company: data.company || null,
    };
  },

  async getAllEmployees() {
    const { data, error } = await supabase
      .from("employees")
      .select("*, company:companies(id, name)")
      .neq("is_deleted", true);
    if (error) throw error;

    return data.map((employee) => ({
      id: employee.id,
      email: employee.email,
      name: employee.name,
      department: employee.department,
      subDepartment: employee.sub_department,
      role: employee.role,
      isHead: employee.is_head,
      isHr: employee.is_hr,
      isSuperAdmin: employee.is_super_admin,
      isRoleSimulator: employee.is_role_simulator,
      isIssuedPassword: !!employee.is_issued_password,
      hiddenNavKeys: employee.hidden_nav_keys || [],
      canManageLeaves: employee.can_manage_leaves,
      signaturePath: employee.signature_path || null,
      avatarPath: employee.avatar_path || null,
      dashboardBannerPath: employee.dashboard_banner_path || null,
      dashboardQuote: employee.dashboard_quote || null,
      has_sales_flow: employee.has_sales_flow,
      has_task_flow: employee.has_task_flow,
      has_purchasing_flow: !!employee.has_purchasing_flow,
      offset_hours_balance: employee.offset_hours_balance || 0,
      employment_status: employee.employment_status || null,
      sil_hours_balance: employee.sil_hours_balance || 0,
      companyId: employee.company_id || null,
      company: employee.company || null,
    }));
  },

  async getAllCategories() {
    const { data, error } = await supabase.from("categories").select("*");
    if (error) throw error;

    return data.map((category) => ({
      id: category.id,
      createdAt: category.created_at,
      categoryId: category.category_id,
      description: category.description,
      department: category.department,
      subDepartment: category.sub_department,
    }));
  },

  async createCategory(categoryData) {
    const { data, error } = await supabase
      .from("categories")
      .insert([
        {
          category_id: categoryData.categoryId,
          description: categoryData.description,
          department: categoryData.department,
          sub_department: categoryData.subDepartment,
          updated_at: new Date().toISOString(),
          updated_by: categoryData?.updatedBy || null,
        },
      ])
      .select()
      .single();

    if (error) throw error;
    systemAuditLogService.addSystemEvent(
      "CATEGORY",
      data.id,
      `Category "${data.description}" was created (${data.department || ""}).`,
      { event: "CATEGORY_CREATED", categoryId: data.id },
      categoryData.updatedBy || null,
    ).catch(console.error);
    return data;
  },

  async updateCategory(id, categoryData, actorId = null) {
    const { data, error } = await supabase
      .from("categories")
      .update({
        description: categoryData.description,
        department: categoryData.department,
        sub_department: categoryData.subDepartment,
        updated_at: new Date().toISOString(),
        updated_by: actorId || categoryData?.updatedBy || null,
      })
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;
    systemAuditLogService.addSystemEvent(
      "CATEGORY",
      id,
      `Category "${data.description}" was updated.`,
      { event: "CATEGORY_UPDATED", categoryId: id },
      actorId || categoryData.updatedBy || null,
    ).catch(console.error);
    return data;
  },

  async isCategoryInUse(categoryId) {
    const { data, error } = await supabase
      .from("tasks")
      .select("id")
      .eq("category_id", categoryId)
      .limit(1);

    if (error) throw error;
    return Array.isArray(data) && data.length > 0;
  },

  async deleteCategory(id, actorId = null) {
    const { error } = await supabase.from("categories").delete().eq("id", id);
    if (error) throw error;
    systemAuditLogService.addSystemEvent(
      "CATEGORY",
      id,
      `A task category was deleted.`,
      { event: "CATEGORY_DELETED", categoryId: id },
      actorId || null,
    ).catch(console.error);
    return true;
  },

  async createEmployee(employeeData) {
    const cleanEmail = await prepareEmailForSave(employeeData.email);
    const { data, error } = await supabase
      .from("employees")
      .insert([
        {
          email: cleanEmail,
          name: employeeData.name,
          department: employeeData.department,
          sub_department: employeeData.subDepartment,
          role: employeeData.role,
          is_head: employeeData.isHead,
          is_hr: employeeData.isHr,
          is_super_admin: employeeData.isSuperAdmin,
          can_manage_leaves: employeeData.canManageLeaves,
          has_sales_flow: employeeData.has_sales_flow,
          has_task_flow: employeeData.has_task_flow,
          has_purchasing_flow: employeeData.has_purchasing_flow,
          hidden_nav_keys: employeeData.hiddenNavKeys || [],
          employment_status: employeeData.employment_status || null,
          sil_hours_balance: employeeData.sil_hours_balance || 0,
          offset_hours_balance: employeeData.offset_hours_balance || 0,
          company_id: employeeData.companyId || null,
          updated_at: new Date().toISOString(),
          updated_by: employeeData?.updatedBy || null,
        },
      ])
      .select()
      .single();

    if (error) throw error;
    systemAuditLogService.addSystemEvent(
      "EMPLOYEE",
      data.id,
      `Employee "${data.name}" was created (${data.department || ""} ${data.sub_department ? `/ ${data.sub_department}` : ""}).`,
      { event: "EMPLOYEE_CREATED", employeeId: data.id },
      employeeData.updatedBy || null,
    ).catch(console.error);
    return data;
  },

  async updateEmployee(id, employeeData, actorId = null) {
    const cleanEmail = await prepareEmailForSave(employeeData.email, id);

    const { data: before, error: beforeErr } = await supabase
      .from("employees")
      .select("employment_status, sil_hours_balance, offset_hours_balance")
      .eq("id", id)
      .single();
    if (beforeErr) throw beforeErr;

    const { data, error } = await supabase
      .from("employees")
      .update({
        email: cleanEmail,
        name: employeeData.name,
        department: employeeData.department,
        sub_department: employeeData.subDepartment,
        role: employeeData.role,
        is_head: employeeData.isHead,
        is_hr: employeeData.isHr,
        is_super_admin: employeeData.isSuperAdmin,
        can_manage_leaves: employeeData.canManageLeaves,
        has_sales_flow: employeeData.has_sales_flow,
        has_task_flow: employeeData.has_task_flow,
        has_purchasing_flow: employeeData.has_purchasing_flow,
        hidden_nav_keys: employeeData.hiddenNavKeys !== undefined ? employeeData.hiddenNavKeys : undefined,
        employment_status: employeeData.employment_status || null,
        sil_hours_balance: employeeData.sil_hours_balance !== undefined ? employeeData.sil_hours_balance : undefined,
        offset_hours_balance: employeeData.offset_hours_balance !== undefined ? employeeData.offset_hours_balance : undefined,
        company_id: employeeData.companyId !== undefined ? (employeeData.companyId || null) : undefined,
        updated_at: new Date().toISOString(),
        updated_by: actorId || employeeData?.updatedBy || null,
      })
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    const diffs = [];
    if ((before.employment_status || null) !== (data.employment_status || null)) {
      diffs.push(`employment status changed from "${before.employment_status || "—"}" to "${data.employment_status || "—"}"`);
    }
    if (parseFloat(before.sil_hours_balance || 0) !== parseFloat(data.sil_hours_balance || 0)) {
      diffs.push(`SIL balance changed from ${before.sil_hours_balance || 0} to ${data.sil_hours_balance || 0} hrs`);
    }
    if (parseFloat(before.offset_hours_balance || 0) !== parseFloat(data.offset_hours_balance || 0)) {
      diffs.push(`offset balance changed from ${before.offset_hours_balance || 0} to ${data.offset_hours_balance || 0} hrs`);
    }

    systemAuditLogService.addSystemEvent(
      "EMPLOYEE",
      id,
      diffs.length
        ? `Employee "${data.name}" profile was updated: ${diffs.join("; ")}.`
        : `Employee "${data.name}" profile was updated.`,
      { event: "EMPLOYEE_UPDATED", employeeId: id, hasBalanceOrStatusChange: diffs.length > 0 },
      actorId || employeeData.updatedBy || null,
    ).catch(console.error);
    return data;
  },

  async getEmployeeAvatarPaths() {
    const { data, error } = await supabase
      .from("employees")
      .select("id, avatar_path")
      .neq("is_deleted", true);
    if (error) throw error;
    return data; // [{ id, avatar_path }]
  },

  async deleteEmployee(id, actorId = null) {
    const { data: emp, error: fetchErr } = await supabase
      .from("employees")
      .select("email, name")
      .eq("id", id)
      .single();

    if (fetchErr) throw fetchErr;

    const currentEmail = emp?.email || "";
    const baseEmail = currentEmail.split("#deleted_")[0];
    const archivedEmail = `${baseEmail}#deleted_${Date.now()}`;

    const { error } = await supabase
      .from("employees")
      .update({
        email: archivedEmail,
        is_deleted: true,
        updated_at: new Date().toISOString(),
        updated_by: actorId,
      })
      .eq("id", id);
    if (error) throw error;
    systemAuditLogService.addSystemEvent(
      "EMPLOYEE",
      id,
      "Employee account was deactivated (soft-deleted).",
      { event: "EMPLOYEE_DELETED", employeeId: id },
      actorId || null,
    ).catch(console.error);
    return true;
  },

  async updateSelfPreferences(id, preferences) {
    const payload = {
      updated_at: new Date().toISOString(),
    };

    if (Object.prototype.hasOwnProperty.call(preferences, "avatarPath")) {
      payload.avatar_path = preferences.avatarPath || null;
    }
    if (Object.prototype.hasOwnProperty.call(preferences, "dashboardBannerPath")) {
      payload.dashboard_banner_path = preferences.dashboardBannerPath || null;
    }
    if (Object.prototype.hasOwnProperty.call(preferences, "dashboardQuote")) {
      payload.dashboard_quote = preferences.dashboardQuote || null;
    }

    const { data, error } = await supabase
      .from("employees")
      .update(payload)
      .eq("id", id)
      .select("*")
      .maybeSingle();

    if (error) throw error;
    if (data) return data;

    // Some policies can block returning rows after update; provide a stable shape.
    return {
      id,
      avatar_path: Object.prototype.hasOwnProperty.call(payload, "avatar_path")
        ? payload.avatar_path
        : null,
      dashboard_banner_path: Object.prototype.hasOwnProperty.call(payload, "dashboard_banner_path")
        ? payload.dashboard_banner_path
        : null,
      dashboard_quote: Object.prototype.hasOwnProperty.call(payload, "dashboard_quote")
        ? payload.dashboard_quote
        : null,
    };
  },
};
