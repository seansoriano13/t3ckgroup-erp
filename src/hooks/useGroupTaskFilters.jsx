import { useMemo } from "react";
import { formatDateToYMD } from "../utils/dateUtils";

export function useGroupTaskFilters(rawTasks = [], filters = {}) {
  const {
    searchTerm = "",
    statusFilter = "ALL", // ALL, ACTIVE, COMPLETED
    creatorFilter = "ALL",
    memberFilter = "ALL",
    deptFilter = "ALL",
    subDeptFilter = "ALL",
    timeframe = "DAILY",
    selectedDateFilter = "",
    dueDate = null,
    tagFilter = [],
    crmOnly = false,
  } = filters;

  const filteredTasks = useMemo(() => {
    return rawTasks.filter((task) => {
      // 1. Status Filter
      if (statusFilter === "ACTIVE" && task.status !== "ACTIVE") return false;
      if (statusFilter === "COMPLETED" && task.status === "ACTIVE") return false;

      // 2. Search Filter
      if (searchTerm) {
        const q = searchTerm.toLowerCase();
        const matchesTitle = task.title?.toLowerCase().includes(q);
        const matchesDesc = (task.description || "").toLowerCase().includes(q);
        const matchesCreator = task.creator?.name?.toLowerCase().includes(q);
        const matchesMembers = task.members?.some((m) =>
          m.employee?.name?.toLowerCase().includes(q)
        );

        if (!(matchesTitle || matchesDesc || matchesCreator || matchesMembers)) {
          return false;
        }
      }

      // 3. Creator Filter
      if (creatorFilter !== "ALL" && task.created_by !== creatorFilter) {
        return false;
      }

      // 4. Member Filter
      if (memberFilter !== "ALL") {
        if (!task.members?.some(m => m.employee_id === memberFilter)) return false;
      }

      // 5. Dept Filter
      // Match if creator is in dept OR any member is in dept
      if (deptFilter !== "ALL") {
        const creatorMatch = task.creator?.department === deptFilter;
        const memberMatch = task.members?.some(m => m.employee?.department === deptFilter);
        if (!creatorMatch && !memberMatch) return false;
      }

      // 6. SubDept Filter
      if (subDeptFilter !== "ALL") {
        const creatorMatch = task.creator?.sub_department === subDeptFilter || task.creator?.subDepartment === subDeptFilter;
        const memberMatch = task.members?.some(m => m.employee?.sub_department === subDeptFilter || m.employee?.subDepartment === subDeptFilter);
        if (!creatorMatch && !memberMatch) return false;
      }

      // 7. Created Date Filter
      if (selectedDateFilter) {
        const taskDate = new Date(task.created_at);
        const taskDateStr = formatDateToYMD(taskDate);

        if (timeframe === "DAILY") {
          if (taskDateStr !== selectedDateFilter) return false;
        } else if (timeframe === "MONTHLY" || timeframe === "YEARLY") {
          if (!taskDateStr.startsWith(selectedDateFilter)) return false;
        } else if (timeframe === "WEEKLY") {
          const [y, m, d] = selectedDateFilter.split("-").map(Number);
          const selectedD = new Date(y, m - 1, d);
          const day = selectedD.getDay();
          const diff = selectedD.getDate() - day + (day === 0 ? -6 : 1);
          const startOfWeek = new Date(selectedD);
          startOfWeek.setDate(diff);
          startOfWeek.setHours(0, 0, 0, 0);
          const endOfWeek = new Date(startOfWeek);
          endOfWeek.setDate(startOfWeek.getDate() + 6);
          endOfWeek.setHours(23, 59, 59, 999);

          if (!(taskDate >= startOfWeek && taskDate <= endOfWeek)) return false;
        }
      }

      // 8. Due Date Filter
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

      // 9. Tag Filter (match any of the selected tags)
      if (tagFilter.length > 0) {
        const taskTagIds = (task.tags || []).map((t) => t.id);
        if (!tagFilter.some((id) => taskTagIds.includes(id))) return false;
      }

      // 10. SORS Filter — only tasks linked to an SOR
      if (crmOnly && !task.opportunity_id) return false;

      return true;
    });
  }, [
    rawTasks,
    searchTerm,
    statusFilter,
    creatorFilter,
    memberFilter,
    deptFilter,
    subDeptFilter,
    timeframe,
    selectedDateFilter,
    dueDate,
    tagFilter,
    crmOnly,
  ]);

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
    return Array.from(creatorsMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [rawTasks]);

  const uniqueMembers = useMemo(() => {
    const membersMap = new Map();
    rawTasks.forEach((task) => {
      task.members?.forEach(m => {
        if (m.employee) {
          membersMap.set(m.employee_id, {
            id: m.employee_id,
            name: m.employee.name,
          });
        }
      });
    });
    return Array.from(membersMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [rawTasks]);

  const uniqueTags = useMemo(() => {
    const tagsMap = new Map();
    rawTasks.forEach((task) => {
      (task.tags || []).forEach((tag) => {
        if (tag && !tag.archived_at) tagsMap.set(tag.id, tag);
      });
    });
    return Array.from(tagsMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [rawTasks]);

  return { filteredTasks, uniqueCreators, uniqueMembers, uniqueTags };
}
