import { useMemo } from "react";
import { TASK_STATUS } from "../constants/status";
import { formatDateToYMD } from "../utils/dateUtils";

export function useTaskFilters(rawTasks = [], filters = {}, options = {}) {
  const {
    searchTerm = "",
    statusFilter = "ALL",
    priorityFilter = "ALL",
    hrFilter = "ALL",
    timeframe = "DAILY",
    selectedDateFilter = "",
    deptFilter = "ALL",
    subDeptFilter = "ALL",
    employeeFilter = "ALL",
    reportedToFilter = "ALL",
    sortBy = "NEWEST",
    crmOnly = false,
  } = filters;

  const { isManagement = false, allEmployees = [] } = options;

  // --- 1. THE FILTER & SORT ENGINE ---
  const employeeMap = useMemo(() => {
    if (!isManagement || allEmployees.length === 0) return new Map();
    const map = new Map();
    for (const emp of allEmployees) {
      map.set(emp.id, emp);
    }
    return map;
  }, [isManagement, allEmployees]);

  const filteredTasks = useMemo(() => {
    const filtered = rawTasks.filter((task) => {
      if (task.status === TASK_STATUS.DELETED) return false;

      const desc = task.taskDescription || "";
      const project = task.projectTitle || "";
      const cat = task.categoryId || "";
      const empName = task.loggedByName || "";

      // Search
      const matchesSearch =
        desc.toLowerCase().includes(searchTerm.toLowerCase()) ||
        project.toLowerCase().includes(searchTerm.toLowerCase()) ||
        cat.toLowerCase().includes(searchTerm.toLowerCase()) ||
        empName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (task.paymentVoucher || "").toLowerCase().includes(searchTerm.toLowerCase());

      // Status Filter Logic
      let matchesStatus = true;
      if (statusFilter !== "ALL") {
        if (statusFilter === TASK_STATUS.INCOMPLETE) {
          matchesStatus = task.status === TASK_STATUS.INCOMPLETE;
        } else if (statusFilter === TASK_STATUS.COMPLETE) {
          matchesStatus = task.status === TASK_STATUS.COMPLETE;
        } else if (statusFilter === "COMPLETE_UNVERIFIED") {
          matchesStatus = task.status === TASK_STATUS.COMPLETE && !task.hrVerified;
        } else if (statusFilter === "COMPLETE_VERIFIED") {
          matchesStatus = task.status === TASK_STATUS.COMPLETE && task.hrVerified;
        } else if (statusFilter === TASK_STATUS.AWAITING_APPROVAL) {
          matchesStatus = task.status === TASK_STATUS.AWAITING_APPROVAL;
        } else if (statusFilter === TASK_STATUS.NOT_APPROVED) {
          matchesStatus = task.status === TASK_STATUS.NOT_APPROVED;
        } else if (statusFilter === "DELAYED") {
          const isPending =
            task.status === TASK_STATUS.INCOMPLETE ||
            task.status === TASK_STATUS.AWAITING_APPROVAL;
          if (!isPending || !task.createdAt) {
            matchesStatus = false;
          } else {
            const hrs = (new Date() - new Date(task.createdAt)) / (1000 * 60 * 60);
            matchesStatus = hrs >= 48;
          }
        }
      }

      const matchesPriority =
        priorityFilter === "ALL" || task.priority === priorityFilter;

      // HR Filter
      let matchesHr = true;
      if (hrFilter === "VERIFIED") matchesHr = task.hrVerified === true;
      if (hrFilter === "PENDING")
        matchesHr = task.status === TASK_STATUS.COMPLETE && !task.hrVerified;

      // Date Filter
      let matchesDate = true;
      if (selectedDateFilter) {
        const taskDate = new Date(task.createdAt);
        // Local YYYY-MM-DD, not the UTC one. The date picker hands us a local
        // date, so deriving the task's day in UTC pushed anything logged before
        // 08:00 in Manila onto the previous day and out of its own filter.
        const taskDateStr = formatDateToYMD(taskDate);

        if (timeframe === "DAILY") {
          matchesDate = taskDateStr === selectedDateFilter;
        } else if (timeframe === "MONTHLY" || timeframe === "YEARLY") {
          matchesDate = taskDateStr.startsWith(selectedDateFilter);
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

          matchesDate = taskDate >= startOfWeek && taskDate <= endOfWeek;
        }
      }

      // Hierarchy (Management Only)
      let matchesDept = true,
        matchesSubDept = true,
        matchesEmployee = true,
        matchesReportedTo = true;

      if (isManagement) {
        // Employee filter only needs loggedById — apply it immediately,
        // regardless of whether the full employee list has loaded yet.
        if (employeeFilter !== "ALL")
          matchesEmployee = task.loggedById === employeeFilter;

        // Dept / sub-dept filters need the employee map; skip them while
        // allEmployees is still loading to avoid rejecting every task.
        if (employeeMap.size > 0) {
          const taskOwner = employeeMap.get(task.loggedById);
          if (deptFilter !== "ALL")
            matchesDept = taskOwner?.department === deptFilter;
          if (subDeptFilter !== "ALL")
            // getAllEmployees() maps sub_department → subDepartment (camelCase)
            matchesSubDept = taskOwner?.subDepartment === subDeptFilter;
        }
      }

      if (reportedToFilter !== "ALL") {
        matchesReportedTo = task.reportedTo === reportedToFilter;
      }

      const matchesCrm = !crmOnly || Boolean(task.opportunityId);

      return (
        matchesSearch &&
        matchesStatus &&
        matchesPriority &&
        matchesHr &&
        matchesDate &&
        matchesDept &&
        matchesSubDept &&
        matchesEmployee &&
        matchesReportedTo &&
        matchesCrm
      );
    });

    // Strict Sorting Hierarchy
    return filtered.sort((a, b) => {
      // When NAME sort is selected, alphabetical name is the top priority
      if (sortBy === "NAME") {
        const nameCmp = (a.loggedByName || "").localeCompare(b.loggedByName || "");
        if (nameCmp !== 0) return nameCmp;
      }

      const getStatusRank = (status) => {
        if (status === TASK_STATUS.NOT_APPROVED) return 4;
        if (status === TASK_STATUS.COMPLETE) return 3;
        if (status === TASK_STATUS.AWAITING_APPROVAL) return 2;
        return 1;
      };

      const rankA = getStatusRank(a.status);
      const rankB = getStatusRank(b.status);
      if (rankA !== rankB) return rankA - rankB;

      // Within a status, order by date only, respecting sortBy direction
      if (sortBy === "OLDEST") {
        return new Date(a.createdAt) - new Date(b.createdAt);
      }
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
  }, [
    rawTasks,
    searchTerm,
    statusFilter,
    priorityFilter,
    hrFilter,
    timeframe,
    selectedDateFilter,
    deptFilter,
    subDeptFilter,
    employeeFilter,
    reportedToFilter,
    employeeMap,
    isManagement,
    sortBy,
    crmOnly,
  ]);

  // --- 2. THE EMPLOYEE DEEP-DIVE STATS ---
  const employeeStats = useMemo(() => {
    // Only calculate stats if a specific employee is selected
    if (employeeFilter === "ALL" || filteredTasks.length === 0) return null;

    const total = filteredTasks.length;
    const completed = filteredTasks.filter(
      (t) => t.status === TASK_STATUS.COMPLETE,
    ).length;
    const completionRate = Math.round((completed / total) * 100);

    const gradedTasks = filteredTasks.filter((t) => t.grade > 0);
    const avgGrade =
      gradedTasks.length > 0
        ? (
            gradedTasks.reduce((acc, t) => acc + t.grade, 0) /
            gradedTasks.length
          ).toFixed(1)
        : "N/A";

    const pendingHr = filteredTasks.filter(
      (t) => t.status === TASK_STATUS.COMPLETE && !t.hrVerified,
    ).length;

    return { total, completionRate, avgGrade, pendingHr };
  }, [filteredTasks, employeeFilter]);

  return { filteredTasks, employeeStats };
}
