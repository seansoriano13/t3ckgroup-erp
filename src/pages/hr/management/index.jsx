import { useState, useMemo } from "react";
import { useNavigate } from "react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { employeeService } from "../../../services/employeeService";
import { companyService, matchesCompanyFilter } from "../../../services/companyService";
import ProtectedRoute from "../../../components/ProtectedRoute.jsx";
import toast from "react-hot-toast";
import { useAuth } from "../../../context/AuthContext";
import HRCategoriesConfig from "../../../components/HRCategoriesConfig.jsx";
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
import { SelectField } from "@/components/ui/SelectField";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default function EmployeeManagement() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const navigate = useNavigate();
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
            className="h-[46px] px-6 rounded-xl shrink-0"
            onClick={handleAddNew}
          >
            <UserPlus size={16} />
            Add Employee
          </Button>
        </div>

        {activeTab === "employees" ? (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
            {/* Filter Bar + Add Button */}
            <div>
              <div className="w-full">
                <HRFilters
                  extraFilters={
                    <SelectField
                      value={companyFilter}
                      onChange={setCompanyFilter}
                      options={[
                        { value: "ALL", label: "All companies" },
                        { value: "NONE", label: "No company set" },
                        ...companies.map((c) => ({ value: c.id, label: c.name })),
                      ]}
                      title="Filter by company"
                    />
                  }
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
            </div>

            <div className="bg-card border border-border rounded-2xl shadow-sm overflow-x-auto">
              <Table className="whitespace-nowrap">
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead>Sub-Dept</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead>Balances</TableHead>
                    <TableHead>Role Flags</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell
                        colSpan="7"
                        className="p-10 text-center text-muted-foreground font-bold"
                      >
                        <Spinner size="md" />
                        Loading employees...
                      </TableCell>
                    </TableRow>
                  ) : filteredEmployees.length > 0 ? (
                    filteredEmployees.map((emp) => (
                      <TableRow
                        key={emp.id}
                      >
                        <TableCell className="text-sm font-bold text-foreground flex items-center gap-3">
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
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          <HighlightText text={emp.email} search={searchTerm} />
                        </TableCell>

                        <TableCell className="text-sm text-muted-foreground">
                          <HighlightText
                            text={emp.department || "-"}
                            search={searchTerm}
                          />
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          <HighlightText
                            text={emp.subDepartment || "-"}
                            search={searchTerm}
                          />
                        </TableCell>
                        <TableCell className="text-sm text-foreground font-semibold">
                          <HighlightText
                            text={emp.role || "-"}
                            search={searchTerm}
                          />
                        </TableCell>
                        <TableCell className="text-sm">
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
                        </TableCell>
                        <TableCell className="text-sm">
                          {emp.company?.name ? (
                            <span className="text-muted-foreground">{emp.company.name}</span>
                          ) : (
                            <span className="text-amber-11 bg-amber-2 border border-amber-6 px-2 py-1 rounded text-xs font-bold">
                              No company
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            <span className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">
                              SIL: <span className="text-foreground">{emp.sil_hours_balance || 0}h</span>
                            </span>
                            <span className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">
                              OFFSET: <span className="text-foreground">{emp.offset_hours_balance || 0}h</span>
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs flex gap-1">
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
                        </TableCell>
                        <TableCell className="text-right space-x-2">
                          {!!user?.isSuperAdmin && emp.isIssuedPassword && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleReissuePassword(emp)}
                              className="rounded-xl bg-amber-2 text-amber-11 border border-transparent hover:border-amber-6 hover:bg-amber-3"
                              title="Reissue Password"
                              aria-label="Reissue Password"
                            >
                              <KeyRound size={15} />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleEdit(emp)}
                            className="rounded-xl bg-muted text-foreground border border-transparent hover:border-mauve-5 hover:bg-muted/70"
                            title="Edit Employee"
                            aria-label="Edit Employee"
                          >
                            <Edit size={15} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDelete(emp.id)}
                            className="rounded-xl bg-destructive/10 text-destructive border border-transparent hover:border-destructive/20 hover:bg-destructive/20"
                            title="Delete Employee"
                            aria-label="Delete Employee"
                          >
                            <Trash2 size={15} />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell
                        colSpan="7"
                        className="p-10 text-center text-muted-foreground font-bold italic text-sm"
                      >
                        No employees found.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        ) : activeTab === "categories" ? (
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            <HRCategoriesConfig />
          </div>
        ) : (
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 space-y-6">
            <div className="rounded-2xl border border-border bg-card p-6 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-black text-foreground uppercase tracking-wide">Leave Categories</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Leave categories now live in Settings under HR &amp; Schedule.
                </p>
              </div>
              <Button onClick={() => navigate("/settings?tab=hr")}>Open in Settings</Button>
            </div>
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
