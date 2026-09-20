import { useState, useMemo } from "react"
import DeptSubDeptSelector from "./DeptSubDeptSelector"

export default function CategoryForm({
  initialData,
  onSubmit,
  formId = "category-form",
  isEditing = false,
  rawCategories = [],
  rawEmployees = [],
}) {
  const [formData, setFormData] = useState({
    categoryId: "",
    description: "",
    department: "",
    subDepartment: "",
    ...initialData,
  })

  const uniqueDepts = useMemo(() => {
    const fromCategories = rawCategories.map((c) => c.department)
    const fromEmployees = rawEmployees.map((e) => e.department)
    return [...new Set([...fromCategories, ...fromEmployees])]
      .filter((d) => typeof d === "string" && d.trim())
      .sort()
  }, [rawCategories, rawEmployees])

  const uniqueSubDepts = useMemo(() => {
    const dept = formData.department
    if (!dept) return []

    const fromEmployees = rawEmployees
      .filter((e) => e.department === dept)
      .map((e) => e.subDepartment)

    const fromCategories = rawCategories
      .filter((c) => c.department === dept)
      .map((c) => c.subDepartment)

    return [...new Set([...fromEmployees, ...fromCategories])]
      .filter((s) => typeof s === "string" && s.trim())
      .sort()
  }, [rawEmployees, rawCategories, formData.department])

  const handleSubmit = (e) => {
    e.preventDefault()
    onSubmit(formData)
  }

  return (
    <form id={formId} onSubmit={handleSubmit} className="space-y-5">
      <div className="space-y-4">
        <div className="group">
          <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5 block ml-1">
            Category ID
          </label>
          <input
            required
            type="text"
            value={formData.categoryId}
            disabled={isEditing}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, categoryId: e.target.value }))
            }
            className="w-full bg-muted/40 border border-border rounded-xl px-4 py-3 text-sm outline-none focus:border-mauve-8 focus:ring-4 focus:ring-mauve-8/10 transition-all text-foreground font-medium disabled:opacity-60 disabled:cursor-not-allowed"
          />
        </div>

        <div className="group">
          <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5 block ml-1">
            Description
          </label>
          <input
            required
            type="text"
            value={formData.description}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, description: e.target.value }))
            }
            className="w-full bg-muted/40 border border-border rounded-xl px-4 py-3 text-sm outline-none focus:border-mauve-8 focus:ring-4 focus:ring-mauve-8/10 transition-all text-foreground font-medium"
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
    </form>
  )
}
