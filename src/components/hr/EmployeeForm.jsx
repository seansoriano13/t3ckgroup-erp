import { useState, useEffect, useMemo } from "react"
import { Shield, Users, Briefcase, ListCheck, ChevronDown } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import DeptSubDeptSelector from "./DeptSubDeptSelector"
import Dropdown from "../ui/Dropdown"

export default function EmployeeForm({
  initialData,
  onSubmit,
  formId = "employee-form",
  rawCategories = [],
  rawEmployees = [],
}) {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    department: "",
    subDepartment: "",
    role: "",
    isHead: false,
    isHr: false,
    isSuperAdmin: false,
    has_sales_flow: false,
    has_task_flow: true,
    employment_status: "",
    sil_hours_balance: 0,
    ...initialData,
  })

  useEffect(() => {
    setFormData({
      name: "",
      email: "",
      department: "",
      subDepartment: "",
      role: "",
      isHead: false,
      isHr: false,
      isSuperAdmin: false,
      has_sales_flow: false,
      has_task_flow: true,
      employment_status: "",
      sil_hours_balance: 0,
      ...initialData,
    })
  }, [initialData])

  const uniqueDepts = useMemo(() => {
    const fromCategories = [
      ...new Set(rawCategories.map((c) => c.department).filter(Boolean)),
    ].sort()
    if (!fromCategories.includes("SALES")) {
      fromCategories.push("SALES")
    }
    return fromCategories
  }, [rawCategories])

  const uniqueSubDepts = useMemo(() => {
    const dept = formData.department
    if (!dept) return []

    let subDepts = [
      ...new Set(
        rawCategories
          .filter((c) => c.department === dept)
          .map((c) => c.subDepartment)
          .filter(Boolean),
      ),
    ]

    // Manual injections for specific departments
    if (dept === "SALES") {
      ;["GOV", "NGO", "SALES"].forEach((s) => {
        if (!subDepts.includes(s)) subDepts.push(s)
      })
    }
    if (dept === "OPERATIONS") {
      if (!subDepts.includes("MARKETING")) subDepts.push("MARKETING")
    }

    // Also include sub-depts already assigned to employees in this dept
    const fromEmps = rawEmployees
      .filter((e) => e.department === dept)
      .map((e) => e.subDepartment)
      .filter(Boolean)

    return [...new Set([...subDepts, ...fromEmps])].sort()
  }, [rawCategories, rawEmployees, formData.department])

  const handleSubmit = (e) => {
    e.preventDefault()
    onSubmit(formData)
  }

  return (
    <form id={formId} onSubmit={handleSubmit} className="space-y-5">
      {/* 1. EMPLOYEE NAME */}
      <div className="mb-2">
        <input
          required
          type="text"
          placeholder="Employee Full Name"
          value={formData.name}
          onChange={(e) =>
            setFormData((prev) => ({ ...prev, name: e.target.value }))
          }
          className="w-full text-2xl font-semibold text-foreground bg-transparent outline-none placeholder:text-muted-foreground/40 border-none pb-1"
          autoComplete="off"
        />
      </div>

      {/* 2. ROLE & EMAIL */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
        <div className="bg-muted/30 border border-border rounded-xl p-3 flex flex-col group focus-within:border-mauve-7 focus-within:ring-1 ring-mauve-7 transition-all">
          <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1 block">
            Google Auth Email
          </label>
          <input
            required
            type="email"
            placeholder="e.g. juan@t3ckgroup.com"
            value={formData.email}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, email: e.target.value }))
            }
            className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 outline-none font-medium"
          />
        </div>

        <div className="bg-muted/30 border border-border rounded-xl p-3 flex flex-col group focus-within:border-mauve-7 focus-within:ring-1 ring-mauve-7 transition-all">
          <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1 block">
            Job Role / Title
          </label>
          <input
            type="text"
            value={formData.role}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, role: e.target.value }))
            }
            placeholder="e.g. Marketing Assistant"
            className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 outline-none font-medium"
          />
        </div>
      </div>

      <DeptSubDeptSelector
        department={formData.department}
        subDepartment={formData.subDepartment}
        onDepartmentChange={(val) =>
          setFormData((prev) => ({ ...prev, department: val }))
        }
        onSubDepartmentChange={(val) =>
          setFormData((prev) => ({ ...prev, subDepartment: val }))
        }
        uniqueDepts={uniqueDepts}
        uniqueSubDepts={uniqueSubDepts}
      />

      {/* Employment Status & SIL Balance */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6 pt-4 mt-2 border-t border-border/50">
        <div className="bg-muted/30 border border-border rounded-xl p-3 flex flex-col group focus-within:border-mauve-7 focus-within:ring-1 ring-mauve-7 transition-all">
          <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1 block">
            Employment Status
          </label>
          <Dropdown
            usePortal={true}
            placement="bottom-start"
            trigger={({ isOpen }) => (
              <button
                type="button"
                className="w-full bg-transparent text-sm text-foreground text-left outline-none font-medium flex justify-between items-center cursor-pointer"
              >
                {formData.employment_status || <span className="text-muted-foreground/50">-- Select Status --</span>}
                <ChevronDown size={14} className={`text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} />
              </button>
            )}
          >
            {({ close }) => (
              <div className="p-1 flex flex-col min-w-[150px]">
                {["Regular", "Probationary", "OJT"].map(status => (
                  <button
                    key={status}
                    type="button"
                    onClick={() => {
                      setFormData(prev => ({ ...prev, employment_status: status }));
                      close();
                    }}
                    className={`px-3 py-2 text-sm text-left rounded-lg transition-colors font-medium cursor-pointer ${
                      formData.employment_status === status ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted"
                    }`}
                  >
                    {status}
                  </button>
                ))}
              </div>
            )}
          </Dropdown>
        </div>

        <div className="bg-muted/30 border border-border rounded-xl p-3 flex flex-col group focus-within:border-mauve-7 focus-within:ring-1 ring-mauve-7 transition-all">
          <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1 block flex justify-between">
            <span>SIL Hours Balance</span>
            {initialData?.employment_status !== "Regular" && formData.employment_status === "Regular" && (
              <span className="text-green-500 font-bold ml-2 animate-pulse">+40 hrs auto-grant</span>
            )}
          </label>
          <input
            type="number"
            step="0.5"
            value={formData.sil_hours_balance}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, sil_hours_balance: parseFloat(e.target.value) || 0 }))
            }
            className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 outline-none font-medium"
          />
        </div>
      </div>

      <div className="space-y-3 pt-4 mt-2 border-t border-border/50">
        <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
          <Shield size={12} /> System Access Rights
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {/* Dept Head */}
          <AccessSwitch
            label="Department Head"
            description="Grant approval rights for this dept"
            icon={Shield}
            checked={formData.isHead}
            onChange={(val) =>
              setFormData((prev) => ({ ...prev, isHead: val }))
            }
            activeColor="bg-amber-3 text-amber-10"
            hoverColor="group-hover:bg-amber-2"
          />

          {/* HR Admin */}
          <AccessSwitch
            label="HR Admin"
            description="Access to employee & category management"
            icon={Users}
            checked={formData.isHr}
            onChange={(val) => setFormData((prev) => ({ ...prev, isHr: val }))}
            activeColor="bg-blue-3 text-blue-10"
            hoverColor="group-hover:bg-blue-2"
          />

          {/* Super Admin */}
          <AccessSwitch
            label="Super Admin"
            description="Full global system control"
            icon={Shield}
            checked={formData.isSuperAdmin}
            onChange={(val) =>
              setFormData((prev) => ({ ...prev, isSuperAdmin: val }))
            }
            activeColor="bg-violet-3 text-violet-10"
            hoverColor="group-hover:bg-violet-2"
            iconStrokeWidth={2.5}
          />

          {/* Sales Opportunity access */}
          <AccessSwitch
            label="Sales Opportunities"
            description="Access to the Sales Opportunity Register"
            icon={Briefcase}
            checked={formData.has_sales_flow}
            onChange={(val) =>
              setFormData((prev) => ({ ...prev, has_sales_flow: val }))
            }
            activeColor="bg-green-3 text-green-10"
            hoverColor="group-hover:bg-green-2"
          />

          {/* Task Flow */}
          <AccessSwitch
            label="Task Flow"
            description="Enable task logging and monitoring"
            icon={ListCheck}
            checked={formData.has_task_flow}
            onChange={(val) =>
              setFormData((prev) => ({ ...prev, has_task_flow: val }))
            }
            activeColor="bg-fuchsia-100 text-fuchsia-600"
            hoverColor="group-hover:bg-fuchsia-50"
          />
        </div>
      </div>
    </form>
  )
}

function AccessSwitch({
  label,
  description,
  icon: Icon,
  checked,
  onChange,
  activeColor,
  hoverColor,
  iconStrokeWidth = 2,
}) {
  return (
    <div
      onClick={() => onChange(!checked)}
      className="flex items-center justify-between p-3 rounded-xl border border-border bg-muted/20 hover:bg-muted/40 cursor-pointer transition-colors group select-none"
    >
      <div className="flex items-center gap-3">
        <div
          className={`w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${checked ? activeColor : `bg-muted text-muted-foreground ${hoverColor}`}`}
        >
          <Icon size={18} strokeWidth={iconStrokeWidth} />
        </div>
        <div>
          <p className="text-sm font-bold text-foreground">{label}</p>
          <p className="text-[10px] text-muted-foreground font-medium">
            {description}
          </p>
        </div>
      </div>
      <div onClick={(e) => e.stopPropagation()}>
        <Switch
          className="data-checked:bg-foreground data-checked:text-background"
          checked={checked}
          onCheckedChange={onChange}
        />
      </div>
    </div>
  )
}
