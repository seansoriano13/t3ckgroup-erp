import { useMemo } from "react";

export function useGroupTaskFilters(rawTasks = [], filters = {}) {
  const {
    searchTerm = "",
    statusFilter = "ALL", // ALL, ACTIVE, COMPLETED
    creatorFilter = "ALL",
    dueDate = null,
  } = filters;

  const filteredTasks = useMemo(() => {
    return rawTasks.filter((task) => {
      // 1. Status Filter
      if (statusFilter === "ACTIVE" && task.status !== "ACTIVE") return false;
      if (statusFilter === "COMPLETED" && task.status === "ACTIVE") return false;

      // 2. Search Filter
      if (searchTerm) {
        const q = searchTerm.toLowerCase();
        const matchesTitle = task.title.toLowerCase().includes(q);
        const matchesDesc = (task.description || "").toLowerCase().includes(q);
        const matchesCreator = task.creator?.name.toLowerCase().includes(q);
        const matchesMembers = task.members?.some((m) =>
          m.employee?.name.toLowerCase().includes(q)
        );

        if (!(matchesTitle || matchesDesc || matchesCreator || matchesMembers)) {
          return false;
        }
      }

      // 3. Creator Filter
      if (creatorFilter !== "ALL" && task.created_by !== creatorFilter) {
        return false;
      }

      // 4. Due Date Filter
      if (dueDate) {
        if (!task.due_date) return false;
        const taskDueDate = new Date(task.due_date);
        const filterDate = new Date(dueDate);
        
        const matchesDate = 
          taskDueDate.getFullYear() === filterDate.getFullYear() &&
          taskDueDate.getMonth() === filterDate.getMonth() &&
          taskDueDate.getDate() === filterDate.getDate();
          
        if (!matchesDate) return false;
      }

      return true;
    });
  }, [rawTasks, searchTerm, statusFilter, creatorFilter, dueDate]);

  const uniqueCreators = useMemo(() => {
    const creatorsMap = new Map();
    rawTasks.forEach((task) => {
      if (task.creator) {
        creatorsMap.set(task.created_by, {
          id: task.created_by,
          name: task.creator.name,
        });
      }
    });
    return Array.from(creatorsMap.values());
  }, [rawTasks]);

  return { filteredTasks, uniqueCreators };
}
