import { useState, useEffect, useMemo } from "react"
import { Shield, Users, Briefcase, ListCheck, ShoppingCart, ChevronDown, Clock, EyeOff, X } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import DeptSubDeptSelector from "./DeptSubDeptSelector"
import Dropdown from "../ui/Dropdown"
import { getAllOverridableEntries } from "@/constants/navigation"
import { getPermissionContext } from "@/utils/permissions"

export default function EmployeeForm({
  initialData,
  onSubmit,
  formId = "employee-form",
  rawCategories = [],
  rawEmployees = [],
  rawCompanies = [],
  canGrantLeaveManagement = false,
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
    canManageLeaves: false,
    has_sales_flow: false,
    has_task_flow: true,
    has_purchasing_flow: false,
    employment_status: "",
    sil_hours_balance: 0,
    offset_hours_balance: 0,
    companyId: null,
    ...initialData,
  })

  const [hasAutoGranted, setHasAutoGranted] = useState(false)

  useEffect(() => {
    // The form is reseeded whenever the record it edits changes; without
    // this it would keep showing the previously-opened employee.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFormData({
      name: "",
      email: "",
      department: "",
      subDepartment: "",
      role: "",
      isHead: false,
      isHr: false,
      isSuperAdmin: false,
      canManageLeaves: false,
      has_sales_flow: false,
      has_task_flow: true,
      has_purchasing_flow: false,
      hiddenNavKeys: [],
      employment_status: "",
      sil_hours_balance: 0,
      offset_hours_balance: 0,
      companyId: null,
      ...initialData,
    })
    setHasAutoGranted(false)
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

  // What the toggles above currently permit, live — the override list only
  // ever shows entries the flags already grant, since hiding one that the
  // flags deny already would be a no-op and confusing to present as a choice.
  const permittedEntries = useMemo(() => {
    const ctx = getPermissionContext(formData)
    return getAllOverridableEntries().filter((entry) => entry.isPermitted(ctx))
  }, [formData])

  const toggleHiddenKey = (key) =>
    setFormData((prev) => {
      const hiddenNavKeys = prev.hiddenNavKeys || []
      return {
        ...prev,
        hiddenNavKeys: hiddenNavKeys.includes(key)
          ? hiddenNavKeys.filter((k) => k !== key)
          : [...hiddenNavKeys, key],
      }
    })

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
        <Input
          required
          type="email"
          label="Google Auth Email"
          placeholder="e.g. juan@t3ckgroup.com"
          value={formData.email}
          onChange={(e) =>
            setFormData((prev) => ({ ...prev, email: e.target.value }))
          }
        />

        <Input
          type="text"
          label="Job Role / Title"
          value={formData.role}
          onChange={(e) =>
            setFormData((prev) => ({ ...prev, role: e.target.value }))
          }
          placeholder="e.g. Marketing Assistant"
        />
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

      {/* Company (issue #142) — nullable; a blank entry is filed as a blank
          on the printed forms rather than guessed. */}
      <div className="bg-muted/30 border border-border rounded-xl p-3 flex flex-col group focus-within:border-mauve-7 focus-within:ring-1 ring-mauve-7 transition-all mb-6">
        <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1 block">
          Name of Company
        </label>
        <Dropdown
          usePortal={true}
          placement="bottom-start"
          trigger={({ isOpen }) => (
            <Button
              type="button"
              variant="ghost"
              className="w-full h-auto justify-between bg-transparent text-sm text-foreground text-left outline-none font-medium flex items-center cursor-pointer hover:bg-transparent"
            >
              {rawCompanies.find((c) => c.id === formData.companyId)?.name || (
                <span className="text-muted-foreground/50">-- No company set --</span>
              )}
              <ChevronDown size={14} className={`text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} />
            </Button>
          )}
        >
          {({ close }) => (
            <div className="p-1 flex flex-col min-w-[220px]">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setFormData((prev) => ({ ...prev, companyId: null }))
                  close()
                }}
                className={`h-auto justify-start px-3 py-2 text-sm text-left rounded-lg transition-colors font-medium cursor-pointer ${
                  !formData.companyId ? "bg-primary/10 text-primary hover:bg-primary/10" : "text-foreground hover:bg-muted"
                }`}
              >
                -- No company set --
              </Button>
              {rawCompanies.map((company) => (
                <Button
                  key={company.id}
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setFormData((prev) => ({ ...prev, companyId: company.id }))
                    close()
                  }}
                  className={`h-auto justify-start px-3 py-2 text-sm text-left rounded-lg transition-colors font-medium cursor-pointer ${
                    formData.companyId === company.id ? "bg-primary/10 text-primary hover:bg-primary/10" : "text-foreground hover:bg-muted"
                  }`}
                >
                  {company.name}
                </Button>
              ))}
            </div>
          )}
        </Dropdown>
      </div>

      {/* Employment Status, SIL Balance & Offset Balance */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6 pt-4 mt-2 border-t border-border/50">
        <div className="bg-muted/30 border border-border rounded-xl p-3 flex flex-col group focus-within:border-mauve-7 focus-within:ring-1 ring-mauve-7 transition-all">
          <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1 block">
            Employment Status
          </label>
          <Dropdown
            usePortal={true}
            placement="bottom-start"
            trigger={({ isOpen }) => (
              <Button
                type="button"
                variant="ghost"
                className="w-full h-auto justify-between bg-transparent text-sm text-foreground text-left outline-none font-medium flex items-center cursor-pointer hover:bg-transparent"
              >
                {formData.employment_status || <span className="text-muted-foreground/50">-- Select Status --</span>}
                <ChevronDown size={14} className={`text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} />
              </Button>
            )}
          >
            {({ close }) => (
              <div className="p-1 flex flex-col min-w-[150px]">
                {["Regular", "Probationary", "OJT"].map(status => (
                  <Button
                    key={status}
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setFormData(prev => {
                        const willBeRegular = status === "Regular";
                        const wasRegularInitially = initialData?.employment_status === "Regular";
                        let newSil = parseFloat(prev.sil_hours_balance) || 0;
                        let newlyGranted = hasAutoGranted;
                        
                        if (willBeRegular && !wasRegularInitially && !hasAutoGranted) {
                          newSil += 40;
                          newlyGranted = true;
                        } else if (!willBeRegular && !wasRegularInitially && hasAutoGranted) {
                          newSil = Math.max(0, newSil - 40);
                          newlyGranted = false;
                        }
                        
                        setHasAutoGranted(newlyGranted);
                        
                        return { 
                          ...prev, 
                          employment_status: status,
                          sil_hours_balance: newSil
                        };
                      });
                      close();
                    }}
                    className={`h-auto justify-start px-3 py-2 text-sm text-left rounded-lg transition-colors font-medium cursor-pointer ${
                      formData.employment_status === status ? "bg-primary/10 text-primary hover:bg-primary/10" : "text-foreground hover:bg-muted"
                    }`}
                  >
                    {status}
                  </Button>
                ))}
              </div>
            )}
          </Dropdown>
        </div>

        <div className="bg-muted/30 border border-border rounded-xl p-3 flex flex-col group focus-within:border-mauve-7 focus-within:ring-1 ring-mauve-7 transition-all">
          <label htmlFor="sil-balance" className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1 block flex justify-between">
            <span>SIL Hours Balance</span>
            {hasAutoGranted && (
              <span className="text-green-500 font-bold ml-2 animate-pulse">+40 hrs auto-granted</span>
            )}
          </label>
          <input
            id="sil-balance"
            type="number"
            step="0.5"
            value={formData.sil_hours_balance}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, sil_hours_balance: parseFloat(e.target.value) || 0 }))
            }
            className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 outline-none font-medium"
          />
        </div>

        <div className="bg-muted/30 border border-border rounded-xl p-3 flex flex-col group focus-within:border-mauve-7 focus-within:ring-1 ring-mauve-7 transition-all">
          <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1 block">
            Offset Hours Balance
          </label>
          <input
            type="number"
            step="0.5"
            value={formData.offset_hours_balance}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, offset_hours_balance: parseFloat(e.target.value) || 0 }))
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

          {/* Leave Management — Super Admin only; the database refuses this
              change from anyone else regardless, but hiding it here keeps an
              HR-only editor from seeing a switch they cannot actually use. */}
          {canGrantLeaveManagement && (
            <AccessSwitch
              label="Leave Management"
              description="Approve & reject leave, offset and overtime applications"
              icon={Clock}
              checked={formData.canManageLeaves}
              onChange={(val) =>
                setFormData((prev) => ({ ...prev, canManageLeaves: val }))
              }
              activeColor="bg-orange-3 text-orange-10"
              hoverColor="group-hover:bg-orange-2"
            />
          )}

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

          {/* Purchasing — issue #39 */}
          <AccessSwitch
            label="Purchasing"
            description="Access to the Purchasing Queue"
            icon={ShoppingCart}
            checked={formData.has_purchasing_flow}
            onChange={(val) =>
              setFormData((prev) => ({ ...prev, has_purchasing_flow: val }))
            }
            activeColor="bg-amber-3 text-amber-10"
            hoverColor="group-hover:bg-amber-2"
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

      {/* Hidden-from-navigation override (#133-135). Presentation only: this
          can never grant anything the toggles above deny, and it cannot
          hide an entry HR just revoked here — the list always reflects the
          current toggle state, live. */}
      <div className="space-y-3 pt-4 mt-2 border-t border-border/50">
        <div className="flex items-center justify-between">
          <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
            <EyeOff size={12} /> Hidden From Navigation
          </label>
          {formData.hiddenNavKeys?.length > 0 && (
            <Button
              type="button"
              variant="link"
              onClick={() => setFormData((prev) => ({ ...prev, hiddenNavKeys: [] }))}
              className="h-auto p-0 text-[10px] font-bold text-muted-foreground hover:text-foreground uppercase tracking-widest flex items-center gap-1 cursor-pointer"
            >
              <X size={11} /> Clear all
            </Button>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          This controls what is shown in this employee's sidebar, not what
          they are permitted to do. It can only hide entries their access
          rights above already grant — it can never reveal anything those
          rights deny.
        </p>
        {permittedEntries.length === 0 ? (
          <p className="text-[11px] text-muted-foreground/70 italic">
            Nothing to hide yet — this employee's access rights don't grant any navigation entries.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {permittedEntries.map((entry) => {
              const hidden = (formData.hiddenNavKeys || []).includes(entry.key)
              return (
                <div
                  key={entry.key}
                  onClick={() => toggleHiddenKey(entry.key)}
                  className="flex items-center justify-between p-2.5 rounded-lg border border-border bg-muted/20 hover:bg-muted/40 cursor-pointer transition-colors select-none"
                >
                  <div>
                    <p className={`text-xs font-bold ${hidden ? "text-muted-foreground line-through" : "text-foreground"}`}>
                      {entry.label}
                    </p>
                    <p className="text-[10px] text-muted-foreground font-medium">{entry.group}</p>
                  </div>
                  <div onClick={(e) => e.stopPropagation()}>
                    <Switch
                      className="data-checked:bg-foreground data-checked:text-background"
                      checked={hidden}
                      onCheckedChange={() => toggleHiddenKey(entry.key)}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        )}
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
