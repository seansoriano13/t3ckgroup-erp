import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { employeeService } from "../../../services/employeeService";
import { companyService, matchesCompanyFilter } from "../../../services/companyService";
import ProtectedRoute from "../../../components/ProtectedRoute.jsx";
import toast from "react-hot-toast";
import { useAuth } from "../../../context/AuthContext";
import HRCategoriesConfig from "../../../components/HRCategoriesConfig.jsx";
import LeaveCategoriesConfig from "../../../components/hr/LeaveCategoriesConfig.jsx";
import { UserPlus, Edit, Trash2, Shield, KeyRound } from "lucide-react";
import { passwordService } from "../../../services/passwordService";
import Spinner from "@/components/ui/Spinner";
import { Dialog, DialogContent } from "../../../components/ui/dialog";
import PageHeader from "../../../components/ui/PageHeader";
import PageContainer from "../../../components/ui/PageContainer";
import TabGroup from "../../../components/ui/TabGroup";
import HighlightText from "../../../components/HighlightText";
import Avatar from "@/components/Avatar";
import { useEmployeeAvatarMap } from "../../../hooks/useEmployeeAvatarMap";
import { Button } from "@/components/ui/button";
import HRFormModal from "../../../components/hr/HRFormModal";
import EmployeeForm from "../../../components/hr/EmployeeForm";
import HRFilters from "../../../components/HRFilters";
import { confirmActionToast } from "../../../components/ui/CustomToast";
import { silService } from "../../../services/silService";
import { offsetService } from "../../../services/offsetService";

export default function EmployeeManagement() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState("employees");
  const [searchTerm, setSearchTerm] = useState("");
  const [deptFilter, setDeptFilter] = useState("ALL");
  const [subDeptFilter, setSubDeptFilter] = useState("ALL");
  const [roleFilter, setRoleFilter] = useState("ALL");
  const [roleFlagFilter, setRoleFlagFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [companyFilter, setCompanyFilter] = useState("ALL"); // company id, "ALL", or "NONE"
  const [sortBy, setSortBy] = useState("NAME_ASC");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState(null);
  const avatarMap = useEmployeeAvatarMap();
  const resolvedAvatars = useMemo(
    () => Object.fromEntries(avatarMap),
    [avatarMap],
  );

  const { data: employees = [], isLoading } = useQuery({
    queryKey: ["allEmployees"],
    queryFn: () => employeeService.getAllEmployees(),
  });

  const { data: companies = [] } = useQuery({
    queryKey: ["companies"],
    queryFn: () => companyService.getCompanies(),
  });

  // Derived option lists
  const uniqueDepts = useMemo(
    () =>
      [...new Set(employees.map((e) => e.department).filter(Boolean))].sort(),
    [employees],
  );
  const uniqueSubDepts = useMemo(() => {
    const base =
      deptFilter === "ALL"
        ? employees
        : employees.filter((e) => e.department === deptFilter);
    return [
      ...new Set(base.map((e) => e.subDepartment).filter(Boolean)),
    ].sort();
  }, [employees, deptFilter]);
  const uniqueRoles = useMemo(
    () => [...new Set(employees.map((e) => e.role).filter(Boolean))].sort(),
    [employees],
  );
  const uniqueStatuses = useMemo(
    () => [...new Set(employees.map((e) => e.employment_status).filter(Boolean))].sort(),
    [employees],
  );

  const filteredEmployees = useMemo(() => {
    const q = searchTerm.toLowerCase();
    let list = employees.filter(
      (emp) =>
        emp.name?.toLowerCase().includes(q) ||
        emp.email?.toLowerCase().includes(q),
    );

    if (deptFilter !== "ALL")
      list = list.filter((e) => e.department === deptFilter);
    if (subDeptFilter !== "ALL")
      list = list.filter((e) => e.subDepartment === subDeptFilter);
    if (roleFilter !== "ALL") list = list.filter((e) => e.role === roleFilter);
    if (statusFilter !== "ALL") list = list.filter((e) => e.employment_status === statusFilter);
    list = list.filter((e) => matchesCompanyFilter(e.companyId, companyFilter));
    if (roleFlagFilter !== "ALL") {
      list = list.filter((e) => {
        if (roleFlagFilter === "SUPER_ADMIN") return e.isSuperAdmin;
        if (roleFlagFilter === "HR") return e.isHr;
        if (roleFlagFilter === "HEAD") return e.isHead;
        if (roleFlagFilter === "LEAVE_MANAGER") return e.canManageLeaves;
        if (roleFlagFilter === "STANDARD")
          return !e.isSuperAdmin && !e.isHr && !e.isHead && !e.canManageLeaves;
        return true;
      });
    }

    if (sortBy === "NAME_ASC")
      list = [...list].sort((a, b) =>
        (a.name || "").localeCompare(b.name || ""),
      );
    else if (sortBy === "NAME_DESC")
      list = [...list].sort((a, b) =>
        (b.name || "").localeCompare(a.name || ""),
      );
    else if (sortBy === "DEPT")
      list = [...list].sort((a, b) =>
        (a.department || "").localeCompare(b.department || ""),
      );

    return list;
  }, [
    employees,
    searchTerm,
    deptFilter,
    subDeptFilter,
    roleFilter,
    statusFilter,
    companyFilter,
    roleFlagFilter,
    sortBy,
  ]);

  const deleteMutation = useMutation({
    mutationFn: (id) => employeeService.deleteEmployee(id, user?.id || null),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["allEmployees"] });
      toast.success("Employee deleted successfully");
    },
    onError: (err) => toast.error("Failed to delete employee: " + err.message),
  });

  const handleDelete = (id) => {
    if (
      window.confirm(
        "Are you sure you want to delete this employee? This action cannot be undone.",
      )
    ) {
      deleteMutation.mutate(id);
    }
  };

  const handleEdit = (employee) => {
    setEditingEmployee(employee);
    setIsModalOpen(true);
  };

  const handleAddNew = () => {
    setEditingEmployee(null);
    setIsModalOpen(true);
  };

  const reissueMutation = useMutation({
    mutationFn: (employeeId) => passwordService.reissuePassword(employeeId),
    onSuccess: (password, employeeId) => {
      const emp = employees.find((e) => e.id === employeeId);
      toast.success(
        `New password for ${emp?.name || "this employee"}: ${password}\nShown once — copy it now.`,
        { duration: Infinity },
      );
    },
    onError: (err) => toast.error(err.message || "Failed to reissue password."),
  });

  const handleReissuePassword = (employee) => {
    if (
      window.confirm(
        `Issue ${employee.name} a new password? Their current one stops working immediately.`,
      )
    ) {
      reissueMutation.mutate(employee.id);
    }
  };

  return (
    <ProtectedRoute requireHr={true}>
      <PageContainer className="pt-4">
        <PageHeader
          title="HR Management"
          description="Manage system access, roles, departments, and task categories."
        />

        <div className="flex-between">
          {/* Tabs */}
          <TabGroup
            variant="pill"
            tabs={[
              { value: "employees", label: "Employees" },
              { value: "categories", label: "Categories Config" },
              { value: "leave_config", label: "Leave & Form Config" },
            ]}
            activeTab={activeTab}
            onChange={setActiveTab}
            size="md"
          />

          <Button
            variant="primary"
            className="h-[46px] px-6 rounded-xl shadow-lg shadow-primary/20 shrink-0"
            onClick={handleAddNew}
          >
            <UserPlus size={16} />
            Add Employee
          </Button>
        </div>

        {activeTab === "employees" ? (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
            {/* Filter Bar + Add Button */}
            <div className="flex flex-col xl:flex-row gap-3 items-start xl:items-end">
              <div className="flex-1 w-full">
                <HRFilters
                  searchTerm={searchTerm}
                  setSearchTerm={setSearchTerm}
                  deptFilter={deptFilter}
                  setDeptFilter={setDeptFilter}
                  subDeptFilter={subDeptFilter}
                  setSubDeptFilter={setSubDeptFilter}
                  roleFilter={roleFilter}
                  setRoleFilter={setRoleFilter}
                  roleFlagFilter={roleFlagFilter}
                  setRoleFlagFilter={setRoleFlagFilter}
                  statusFilter={statusFilter}
                  setStatusFilter={setStatusFilter}
                  sortBy={sortBy}
                  setSortBy={setSortBy}
                  uniqueDepts={uniqueDepts}
                  uniqueSubDepts={uniqueSubDepts}
                  uniqueRoles={uniqueRoles}
                  uniqueStatuses={uniqueStatuses}
                />
              </div>
              <select
                value={companyFilter}
                onChange={(e) => setCompanyFilter(e.target.value)}
                className="h-[46px] px-3 rounded-xl border border-border bg-card text-sm font-medium text-foreground"
                title="Filter by company"
              >
                <option value="ALL">All companies</option>
                <option value="NONE">No company set</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            <div className="bg-card border border-border rounded-2xl shadow-sm overflow-x-auto">
              <table className="w-full text-left border-collapse whitespace-nowrap">
                <thead>
                  <tr className="bg-muted/50 border-b border-border text-[10px] font-black text-muted-foreground uppercase tracking-[0.15em]">
                    <th className="p-4">Name</th>
                    <th className="p-4">Email</th>
                    <th className="p-4">Department</th>
                    <th className="p-4">Sub-Dept</th>
                    <th className="p-4">Role</th>
                    <th className="p-4">Status</th>
                    <th className="p-4">Company</th>
                    <th className="p-4">Balances</th>
                    <th className="p-4">Role Flags</th>
                    <th className="p-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {isLoading ? (
                    <tr>
                      <td
                        colSpan="7"
                        className="p-10 text-center text-muted-foreground font-bold"
                      >
                        <Spinner size="md" />
                        Loading employees...
                      </td>
                    </tr>
                  ) : filteredEmployees.length > 0 ? (
                    filteredEmployees.map((emp) => (
                      <tr
                        key={emp.id}
                        className="hover:bg-muted/30 transition-colors"
                      >
                        <td className="p-4 text-sm font-bold text-foreground flex items-center gap-3">
                          <Avatar
                            src={resolvedAvatars[emp.id]}
                            name={emp.name}
                            size="md"
                            className="w-9 h-9"
                          />
                          <div className="truncate">
                            <p className="font-black text-foreground">
                              <HighlightText
                                text={emp.name}
                                search={searchTerm}
                              />
                            </p>

                            <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest">
                              {emp.id?.slice(0, 8)}...
                            </p>
                          </div>
                        </td>
                        <td className="p-4 text-sm text-muted-foreground">
                          <HighlightText text={emp.email} search={searchTerm} />
                        </td>

                        <td className="p-4 text-sm text-muted-foreground">
                          <HighlightText
                            text={emp.department || "-"}
                            search={searchTerm}
                          />
                        </td>
                        <td className="p-4 text-sm text-muted-foreground">
                          <HighlightText
                            text={emp.subDepartment || "-"}
                            search={searchTerm}
                          />
                        </td>
                        <td className="p-4 text-sm text-foreground font-semibold">
                          <HighlightText
                            text={emp.role || "-"}
                            search={searchTerm}
                          />
                        </td>
                        <td className="p-4 text-sm">
                          {emp.employment_status ? (
                            <span className={`px-2 py-1 rounded text-xs font-bold ${emp.employment_status === 'Regular' ? 'bg-green-100 text-green-700' :
                                emp.employment_status === 'Probationary' ? 'bg-amber-100 text-amber-700' :
                                  'bg-blue-100 text-blue-700'
                              }`}>
                              {emp.employment_status}
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-xs italic">-</span>
                          )}
                        </td>
                        <td className="p-4 text-sm">
                          {emp.company?.name ? (
                            <span className="text-muted-foreground">{emp.company.name}</span>
                          ) : (
                            <span className="text-amber-11 bg-amber-2 border border-amber-6 px-2 py-1 rounded text-xs font-bold">
                              No company
                            </span>
                          )}
                        </td>
                        <td className="p-4">
                          <div className="flex flex-col gap-1">
                            <span className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">
                              SIL: <span className="text-foreground">{emp.sil_hours_balance || 0}h</span>
                            </span>
                            <span className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">
                              OFFSET: <span className="text-foreground">{emp.offset_hours_balance || 0}h</span>
                            </span>
                          </div>
                        </td>
                        <td className="p-4 text-xs flex gap-1">
                          {emp.isSuperAdmin && (
                            <span className="bg-violet-2 text-violet-11 border border-mauve-5 px-2.5 py-1 rounded-lg font-black text-[10px] flex items-center gap-1 uppercase tracking-wider">
                              <Shield size={11} /> Super Admin
                            </span>
                          )}
                          {emp.isHr && (
                            <span className="bg-blue-2 text-blue-11 border border-blue-6 px-2.5 py-1 rounded-lg font-black text-[10px] uppercase tracking-wider">
                              HR
                            </span>
                          )}
                          {emp.isHead && (
                            <span className="bg-amber-2 text-amber-11 border border-amber-6 px-2.5 py-1 rounded-lg font-black text-[10px] uppercase tracking-wider">
                              Head
                            </span>
                          )}
                          {emp.canManageLeaves && (
                            <span className="bg-orange-2 text-orange-11 border border-orange-6 px-2.5 py-1 rounded-lg font-black text-[10px] uppercase tracking-wider">
                              Leave Mgr
                            </span>
                          )}
                          {!emp.isSuperAdmin && !emp.isHr && !emp.isHead && !emp.canManageLeaves && (
                            <span className="bg-muted text-muted-foreground border border-border px-2.5 py-1 rounded-lg font-black text-[10px] uppercase tracking-wider">
                              Standard
                            </span>
                          )}
                          {emp.isIssuedPassword && (
                            <span
                              className="bg-amber-2 text-amber-11 border border-amber-6 px-2.5 py-1 rounded-lg font-black text-[10px] flex items-center gap-1 uppercase tracking-wider"
                              title="Still signed in with an issued password"
                            >
                              <KeyRound size={11} /> Issued Password
                            </span>
                          )}
                        </td>
                        <td className="p-4 text-right space-x-2">
                          {!!user?.isSuperAdmin && emp.isIssuedPassword && (
                            <button
                              onClick={() => handleReissuePassword(emp)}
                              className="p-2 bg-amber-2 hover:bg-amber-3 text-amber-11 rounded-xl transition-all inline-block border border-transparent hover:border-amber-6"
                              title="Reissue Password"
                            >
                              <KeyRound size={15} />
                            </button>
                          )}
                          <button
                            onClick={() => handleEdit(emp)}
                            className="p-2 bg-muted hover:bg-muted/70 text-foreground rounded-xl transition-all inline-block hover:border-mauve-5 border border-transparent"
                            title="Edit Employee"
                          >
                            <Edit size={15} />
                          </button>
                          <button
                            onClick={() => handleDelete(emp.id)}
                            className="p-2 bg-destructive/10 hover:bg-destructive/20 text-destructive rounded-xl transition-all inline-block border border-transparent hover:border-destructive/20"
                            title="Delete Employee"
                          >
                            <Trash2 size={15} />
                          </button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td
                        colSpan="7"
                        className="p-10 text-center text-muted-foreground font-bold italic text-sm"
                      >
                        No employees found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : activeTab === "categories" ? (
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            <HRCategoriesConfig />
          </div>
        ) : (
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 space-y-6">
            <LeaveCategoriesConfig />
          </div>
        )}

        <EmployeeFormModal
          isOpen={isModalOpen}
          employee={editingEmployee}
          onClose={() => setIsModalOpen(false)}
        />
      </PageContainer>
    </ProtectedRoute>
  );
}

function EmployeeFormModal({ isOpen, employee, onClose }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isEditing = !!employee;

  const { data: rawCategories = [] } = useQuery({
    queryKey: ["allCategories"],
    queryFn: () => employeeService.getAllCategories(),
  });

  const { data: employees = [] } = useQuery({
    queryKey: ["allEmployees"],
    queryFn: () => employeeService.getAllEmployees(),
  });

  const { data: companies = [] } = useQuery({
    queryKey: ["companies"],
    queryFn: () => companyService.getCompanies(),
  });

  const mutation = useMutation({
    mutationFn: (data) => {
      const payload = { ...data };
      return isEditing
        ? employeeService.updateEmployee(employee.id, payload, user?.id || null)
        : employeeService.createEmployee({
          ...payload,
          updatedBy: user?.id || null,
        });
    },
    onSuccess: async (data) => {
      queryClient.invalidateQueries({ queryKey: ["allEmployees"] });
      toast.success(isEditing ? "Employee updated!" : "Employee added!");
      onClose();

      if (!isEditing && data?.id) {
        try {
          const password = await passwordService.issuePassword(data.id);
          toast.success(
            `Password for ${data.name}: ${password}\nShown once — copy it now.`,
            { duration: Infinity },
          );
        } catch (err) {
          console.error("Failed to issue a password for the new employee:", err);
          toast.error(
            `Employee added, but issuing a sign-in password failed: ${err.message || "unknown error"}`,
          );
        }
      }
    },
    onError: (err) => {
      toast.error(err.message || "Failed to save employee.");
    },
  });

  // Warn (non-blocking) if this save would leave already-approved future leave
  // "unbacked" by the new balance/status — e.g. downgrading to Probationary or
  // zeroing a balance while a future SIL/Offset leave is still APPROVED.
  const handleSubmit = async (data) => {
    if (isEditing && employee) {
      const newSil = parseFloat(data.sil_hours_balance) || 0;
      const newOffset = parseFloat(data.offset_hours_balance) || 0;
      const oldSil = parseFloat(employee.sil_hours_balance) || 0;
      const oldOffset = parseFloat(employee.offset_hours_balance) || 0;
      const statusDowngraded =
        employee.employment_status === "Regular" && data.employment_status !== "Regular";
      const silReduced = newSil < oldSil;
      const offsetReduced = newOffset < oldOffset;

      if (statusDowngraded || silReduced || offsetReduced) {
        try {
          const [silLeaves, offsetLeaves] = await Promise.all([
            silService.getMySilLeaves(employee.id),
            offsetService.getMyOffsetLeaves(employee.id),
          ]);
          const today = new Date().toISOString().slice(0, 10);
          const approvedFutureSil = silLeaves.filter((l) => l.status === "APPROVED" && l.date >= today);
          const approvedFutureOffset = offsetLeaves.filter((l) => l.status === "APPROVED" && l.date >= today);

          if (approvedFutureSil.length || approvedFutureOffset.length) {
            const parts = [];
            if (approvedFutureSil.length) {
              const hrs = approvedFutureSil.reduce((s, l) => s + (parseFloat(l.hours) || 0), 0);
              parts.push(`${approvedFutureSil.length} approved SIL leave${approvedFutureSil.length > 1 ? "s" : ""} (${hrs} hrs)`);
            }
            if (approvedFutureOffset.length) {
              const hrs = approvedFutureOffset.reduce((s, l) => s + (parseFloat(l.hours) || 0), 0);
              parts.push(`${approvedFutureOffset.length} approved offset leave${approvedFutureOffset.length > 1 ? "s" : ""} (${hrs} hrs)`);
            }

            confirmActionToast(
              "Employee Has Upcoming Approved Leave",
              `${employee.name} still has ${parts.join(" and ")} for a future date. This change won't cancel them — review the HR Offsets page if they should be rejected. Save anyway?`,
              "Save Anyway",
              "destructive",
              () => mutation.mutate(data),
            );
            return;
          }
        } catch (err) {
          console.error("Failed to check for conflicting approved leave:", err);
        }
      }
    }
    mutation.mutate(data);
  };

  return (
    <HRFormModal
      isOpen={isOpen}
      onClose={onClose}
      title={isEditing ? "Edit Employee" : "Add Employee"}
      subtitle={
        isEditing
          ? `Employee ID: ${employee.id?.slice(0, 8)}...`
          : "Define system access & roles"
      }
      icon={isEditing ? Edit : UserPlus}
      formId="employee-form"
      isPending={mutation.isPending}
      submitLabel={isEditing ? "Update Employee" : "Add Employee"}
    >
      <EmployeeForm
        key={employee ? employee.id : "new-employee"}
        initialData={employee}
        onSubmit={handleSubmit}
        rawCategories={rawCategories}
        rawEmployees={employees}
        rawCompanies={companies}
        canGrantLeaveManagement={!!user?.isSuperAdmin}
      />
    </HRFormModal>
  );
}
