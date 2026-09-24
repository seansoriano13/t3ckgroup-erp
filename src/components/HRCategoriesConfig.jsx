import { useMemo, useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import toast from "react-hot-toast"
import { Plus, Edit, Trash2, XSquare } from "lucide-react"
import Spinner from "@/components/ui/Spinner"
import { Button } from "@/components/ui/button"
import { employeeService } from "../services/employeeService"
import { useAuth } from "../context/AuthContext"
import { confirmDeleteToast } from "./ui/CustomToast"
import HRFormModal from "./hr/HRFormModal"
import CategoryForm from "./hr/CategoryForm"
import { Input } from "@/components/ui/input";

export default function HRCategoriesConfig() {
  const queryClient = useQueryClient()
  const { user } = useAuth()

  const {
    data: categories = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["allCategories"],
    queryFn: () => employeeService.getAllCategories(),
  })

  const { data: employees = [] } = useQuery({
    queryKey: ["allEmployees"],
    queryFn: () => employeeService.getAllEmployees(),
  })

  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingCategory, setEditingCategory] = useState(null)
  const [searchTerm, setSearchTerm] = useState("")

  const openAdd = () => {
    setEditingCategory(null)
    setIsModalOpen(true)
  }

  const openEdit = (cat) => {
    setEditingCategory(cat)
    setIsModalOpen(true)
  }

  const deleteMutation = useMutation({
    mutationFn: async (cat) => {
      const inUse = await employeeService.isCategoryInUse(cat.categoryId)
      if (inUse) {
        throw new Error(
          "This category is already used by existing tasks. Delete is blocked to prevent breaking task mappings.",
        )
      }
      return employeeService.deleteCategory(cat.id, user?.id)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["allCategories"] })
      toast.success("Category deleted.")
    },
    onError: (err) => toast.error(err?.message || "Failed to delete category."),
  })

  const filteredCategories = useMemo(() => {
    return categories.filter(
      (cat) =>
        cat.categoryId.toLowerCase().includes(searchTerm.toLowerCase()) ||
        cat.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
        cat.department?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        cat.subDepartment?.toLowerCase().includes(searchTerm.toLowerCase()),
    )
  }, [categories, searchTerm])

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="bg-mauve-2 border border-mauve-4 p-4 rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm relative z-20">
        <div className="relative flex-1 md:max-w-sm">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 text-mauve-8"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <Input
            type="text"
            placeholder="Search categories..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            containerClassName="w-full" className="pl-10 pr-4"
          />
        </div>

        <Button
          type="button"
          onClick={openAdd}
          className="h-auto flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-bold text-sm shadow-sm active:scale-95"
        >
          <Plus size={18} /> Add Category
        </Button>
      </div>

      <div className="bg-mauve-2 border border-mauve-4 rounded-xl shadow-lg overflow-x-auto">
        {isLoading ? (
          <div className="py-10 flex flex-col items-center justify-center gap-3">
            <Spinner size="md" />
            <p className="text-muted-foreground font-bold">
              Loading categories...
            </p>
          </div>
        ) : isError ? (
          <div className="p-8 text-center bg-red-a2 border-b border-red-a5">
            <p className="text-red-11 font-bold">Failed to load categories.</p>
          </div>
        ) : categories.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground font-bold">
            No categories found. Add the first one.
          </div>
        ) : (
          <table className="w-full text-left border-collapse whitespace-nowrap">
            <thead>
              <tr className="bg-mauve-1 border-b border-mauve-4 text-xs font-bold text-muted-foreground uppercase tracking-wider">
                <th className="p-4">Category ID</th>
                <th className="p-4 w-1/3">Description</th>
                <th className="p-4">Department</th>
                <th className="p-4">Sub-Department</th>
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-4">
              {filteredCategories.length > 0 ? (
                filteredCategories.map((cat) => (
                  <tr
                    key={cat.id}
                    className="hover:bg-mauve-3/30 transition-colors"
                  >
                    <td className="p-4">
                      <span className="text-xs font-bold text-foreground bg-mauve-3 px-2 py-1 rounded border border-mauve-4">
                        {cat.categoryId}
                      </span>
                    </td>
                    <td className="p-4 text-sm text-mauve-11 truncate max-w-xs">
                      {cat.description}
                    </td>
                    <td className="p-4 text-sm text-mauve-11">
                      {cat.department || "-"}
                    </td>
                    <td className="p-4 text-sm text-mauve-11">
                      {cat.subDepartment || "-"}
                    </td>
                    <td className="p-4 text-right space-x-2">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => openEdit(cat)}
                        className="h-auto w-auto p-2 bg-mauve-3 hover:bg-mauve-4 text-foreground rounded-lg transition-colors inline-block"
                        title="Edit Category"
                      >
                        <Edit size={16} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => {
                          confirmDeleteToast(
                            `Delete Category?`,
                            `"${cat.categoryId}" will be permanently removed. This cannot be undone.`,
                            () => deleteMutation.mutate(cat),
                          )
                        }}
                        className="h-auto w-auto p-2 bg-red-3 hover:bg-red-6 text-destructive rounded-lg transition-colors inline-block"
                        title="Delete Category"
                        disabled={deleteMutation.isPending}
                      >
                        <Trash2 size={16} />
                      </Button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    colSpan="5"
                    className="p-8 text-center text-muted-foreground font-bold"
                  >
                    No categories found matching your search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      <CategoryFormModal
        isOpen={isModalOpen}
        category={editingCategory}
        onClose={() => setIsModalOpen(false)}
        rawCategories={categories}
        rawEmployees={employees}
      />
    </div>
  )
}

function CategoryFormModal({
  isOpen,
  category,
  onClose,
  rawCategories,
  rawEmployees,
}) {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const isEditing = !!category

  const upsertMutation = useMutation({
    mutationFn: async (data) => {
      const actorId = user?.id || null
      if (isEditing)
        return employeeService.updateCategory(category.id, data, actorId)
      return employeeService.createCategory({ ...data, updatedBy: actorId })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["allCategories"] })
      toast.success(isEditing ? "Category updated!" : "Category added!")
      onClose()
    },
    onError: (err) => {
      toast.error(err?.message || "Failed to save category.")
    },
  })

  return (
    <HRFormModal
      isOpen={isOpen}
      onClose={onClose}
      title={isEditing ? "Edit Category" : "Add Category"}
      subtitle={
        isEditing
          ? `Category ID: ${category?.categoryId}`
          : "Define task categories"
      }
      icon={isEditing ? Edit : Plus}
      formId="category-form"
      isPending={upsertMutation.isPending}
      submitLabel={isEditing ? "Update Category" : "Add Category"}
    >
      <CategoryForm
        initialData={category}
        isEditing={isEditing}
        rawCategories={rawCategories}
        rawEmployees={rawEmployees}
        onSubmit={(data) => upsertMutation.mutate(data)}
      />
    </HRFormModal>
  )
}
