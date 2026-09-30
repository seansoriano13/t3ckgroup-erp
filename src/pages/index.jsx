import { useAuth } from "../context/AuthContext";
import ProtectedRoute from "../components/ProtectedRoute";

import TasksList from "../components/TasksList.jsx";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import DashboardStats from "../components/DashboardStats.jsx";
import EmployeePipelineMatrix from "../components/EmployeePipelineMatrix.jsx";
import PersonalPipelineRadar from "../components/PersonalPipelineRadar.jsx";
import EmployeeOpportunityMatrix from "../components/sor/EmployeeOpportunityMatrix.jsx";
import PersonalOpportunityOverview from "../components/sor/PersonalOpportunityOverview.jsx";
import { opportunityService } from "../services/opportunityService.js";
import FloatingMonthPicker from "../components/FloatingMonthPicker.jsx";
import SystemUpdateBanner from "../components/SystemUpdateBanner.jsx";
import PersonalizedHeroBanner from "../components/PersonalizedHeroBanner.jsx";
import GroupTasksList from "../components/GroupTasksList.jsx";
import PageShell from "../components/ui/PageShell";
import { useTableRealtime } from "../hooks/useTableRealtime.js";

export default function Dashboard() {
  const { user } = useAuth();

  useTableRealtime("tasks", { invalidateKeys: [["dashboardTasks"]] });

  const isPrivileged =
    user?.is_head || user?.isHead || user?.is_hr || user?.isHr || user?.isSuperAdmin;

  // Skip the fetch entirely for employees who'll never touch opportunities
  // (no SOR access, not management) — avoids an org-wide read on every
  // dashboard load for staff who don't need it.
  const { data: opportunities = [] } = useQuery({
    queryKey: ["opportunities"],
    queryFn: () => opportunityService.getOpportunities(),
    enabled: !!(user?.has_sales_flow || isPrivileged),
  });

  // --- GLOBAL RANGE SELECTION ---
  const currentDate = new Date();
  const currentMonthYear = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, "0")}-01`;
  const [globalRange, setGlobalRange] = useState({
    mode: "MONTHLY",
    startDate: currentMonthYear,
    endDate: currentMonthYear, // Fallback, will be instantly overwritten by the TimeRangeSelector
    label: currentDate.toLocaleString("default", {
      month: "short",
      year: "numeric",
    }),
  });

  const isHead = user?.is_head || user?.isHead;

  return (
    <ProtectedRoute>
      <PageShell
        banner={
          <div className="space-y-4">
            <SystemUpdateBanner />
            <PersonalizedHeroBanner />
          </div>
        }
        title={isHead ? "Accomplishment Report" : "Private Workflow"}
        description={
          isHead ? "Executive performance governance" : "Personal execution roadmap"
        }
        action={
          <FloatingMonthPicker
            inline
            selectedRange={globalRange}
            onChange={setGlobalRange}
          />
        }
      >
        <div className="grid gap-10">
          {isPrivileged ? (
            <>
              <DashboardStats selectedRange={globalRange} />
              <EmployeePipelineMatrix selectedRange={globalRange} />
              <EmployeeOpportunityMatrix opportunities={opportunities} />
            </>
          ) : (
            <>
              <PersonalPipelineRadar selectedRange={globalRange} />
              <PersonalOpportunityOverview opportunities={opportunities} />
            </>
          )}

          <TasksList selectedRange={globalRange} />
          <GroupTasksList selectedRange={globalRange} />
        </div>
      </PageShell>
    </ProtectedRoute>
  );
}
