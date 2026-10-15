import { supabase } from "../lib/supabase";
import { systemAuditLogService } from "./systemAuditLogService";
import { IPAS_SIGNER_LISTS } from "../constants/ipas";
import { TRANSMITTAL_STAFF_LIST, TRANSMITTAL_STAFF_LISTS } from "../constants/transmittals";

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

/**
 * Where the employee stands on the IPAS sign-off lists (#242, #247):
 *   isIpasSigner    on any list and no other access reads the IPAS for them
 *                   (Purchasing access, Finance access or Super Admin already
 *                   do), so the navigation shows IPAS
 *   isIpasApprover  on any sign-off list (section 1 or 3 Approved, section 7's
 *                   Received, Noted, Checked or Approved), whatever else they
 *                   hold: a Super Admin signs only when on a list, so this is
 *                   what puts the Approval Center's IPAS queue in front of them
 * A failure reads as "no": the lists are a convenience for the navigation, never
 * the gate (the database is).
 */
async function ipasListMembership(employee) {
  const none = {
    isIpasSigner: false,
    isIpasApprover: false,
    isTransmittalStaff: false,
    isTransmittalWarehouse: false,
    isTransmittalCheckBy: false,
  };
  try {
    const { data, error } = await supabase.from("ipas_signer_lists").select("list_key").eq("employee_id", employee.id);
    if (error) return none;
    // The Transmittal staff lists (#252) read Transmittals, not the IPAS: a
    // member of only those is not an IPAS signer.
    const keys = (data || []).map((row) => row.list_key);
    const ipasKeys = keys.filter((key) => !TRANSMITTAL_STAFF_LISTS.includes(key));
    const readsAnyway = employee.has_purchasing_flow || employee.has_finance_flow || employee.is_super_admin;
    return {
      isIpasSigner: !readsAnyway && ipasKeys.length > 0,
      isIpasApprover: ipasKeys.some((key) => IPAS_SIGNER_LISTS.includes(key)),
      isTransmittalStaff: keys.some((key) => TRANSMITTAL_STAFF_LISTS.includes(key)),
      // On the Transmittal Warehouse list (#255): makes Packing Lists.
      isTransmittalWarehouse: keys.includes(TRANSMITTAL_STAFF_LIST.WAREHOUSE),
      // On the Check by list: the Approval Center's Transmittal queue.
      isTransmittalCheckBy: keys.includes(TRANSMITTAL_STAFF_LIST.CHECK_BY),
    };
  } catch {
    return none;
  }
}

/**
 * A call sign as the database stores it (#247): trimmed, and null when blank.
 * The column refuses an empty or padded string, and an unset call sign is null
 * so any number of people can have none (the unique index is where it's set).
 */
export function cleanCallSign(value) {
  const text = typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
  return text === "" ? null : text;
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

    const ipasLists = await ipasListMembership(data);
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
      // On an IPAS sign-off list: reads every IPAS, so the nav shows the list.
      isIpasSigner: ipasLists.isIpasSigner,
      // On the section 1 or 3 approval list: the Approval Center's IPAS queue.
      isIpasApprover: ipasLists.isIpasApprover,
      // On a Transmittal staff list (#252): the nav shows Transmittals.
      isTransmittalStaff: ipasLists.isTransmittalStaff,
      // On the Transmittal Warehouse list (#255): the nav shows Packing Lists.
      isTransmittalWarehouse: ipasLists.isTransmittalWarehouse,
      // On the Transmittal Check by list: the nav shows the Check by queue.
      isTransmittalCheckBy: ipasLists.isTransmittalCheckBy,
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
      has_finance_flow: !!data.has_finance_flow,
      call_sign: data.call_sign ?? null,
      has_retail_access: !!data.has_retail_access,
      has_bug_report_access: !!data.has_bug_report_access,
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
      has_finance_flow: !!employee.has_finance_flow,
      call_sign: employee.call_sign ?? null,
      has_retail_access: !!employee.has_retail_access,
      has_bug_report_access: !!employee.has_bug_report_access,
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
          has_finance_flow: employeeData.has_finance_flow ?? false,
          call_sign: cleanCallSign(employeeData.call_sign),
          // Open for Sales by default; an explicit choice from the form wins.
          has_retail_access:
            employeeData.has_retail_access ??
            String(employeeData.department ?? "").trim().toUpperCase() === "SALES",
          // Open for the IT Team by default; an explicit choice from the form wins.
          has_bug_report_access:
            employeeData.has_bug_report_access ??
            String(employeeData.subDepartment ?? "").trim().toUpperCase() === "IT",
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
        has_finance_flow: employeeData.has_finance_flow,
        // Only touched when the caller says so: HR and Super Admins set it
        // (the database keeps it as it was for anyone else).
        call_sign: employeeData.call_sign !== undefined ? cleanCallSign(employeeData.call_sign) : undefined,
        has_retail_access: employeeData.has_retail_access,
        has_bug_report_access: employeeData.has_bug_report_access,
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
