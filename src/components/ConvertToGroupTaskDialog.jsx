import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { toast } from "react-hot-toast"
import { employeeService } from "../services/employeeService"
import { taskService } from "../services/taskService"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "./ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { FieldBox } from "@/components/ui/FieldBox"

/**
 * Convert a task into a Group Task (#657). The task becomes the Group Task: its owner is the first
 * member and the user picks more here. `onConverted(groupTaskId)` runs after the database accepts.
 */
export default function ConvertToGroupTaskDialog({ open, onOpenChange, task, onConverted }) {
  const [search, setSearch] = useState("")
  const [picked, setPicked] = useState([])
  const [busy, setBusy] = useState(false)

  const { data: employees = [] } = useQuery({
    queryKey: ["allEmployees"],
    queryFn: () => employeeService.getAllEmployees(),
    enabled: open,
  })

  const choices = useMemo(() => {
    const q = search.trim().toLowerCase()
    return employees
      .filter((e) => e.id !== task?.loggedById)
      .filter((e) => !q || (e.name || "").toLowerCase().includes(q))
      .slice(0, 50)
  }, [employees, search, task?.loggedById])

  const toggle = (id) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  const handleConvert = async () => {
    setBusy(true)
    try {
      const groupTaskId = await taskService.convertToGroupTask(task.id, picked)
      toast.success("Task converted into a Group Task.")
      onOpenChange(false)
      onConverted?.(groupTaskId)
    } catch (err) {
      toast.error(err.message || "Could not convert the task.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="z-[80] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Convert to Group Task</DialogTitle>
          <DialogDescription>
            This task becomes a Group Task and keeps its details, checklist and chat. The task's owner
            is the first member. Pick anyone else to add.
          </DialogDescription>
        </DialogHeader>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search people"
          aria-label="Search people"
        />
        <ul className="max-h-60 space-y-1 overflow-y-auto">
          {choices.map((e) => (
            <li key={e.id}>
              <FieldBox inline className="cursor-pointer rounded-md px-2 py-1.5 text-sm hover:bg-muted">
                <Checkbox checked={picked.includes(e.id)} onCheckedChange={() => toggle(e.id)} />
                <span>{e.name}</span>
              </FieldBox>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={handleConvert} disabled={busy}>
            {busy ? "Converting..." : "Convert"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
