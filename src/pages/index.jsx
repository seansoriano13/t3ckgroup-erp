import { useAuth } from "../context/AuthContext";
import ProtectedRoute from "../components/ProtectedRoute";

import TasksList from "../components/TasksList.jsx";
import { useState } from "react";
import DashboardStats from "../components/DashboardStats.jsx";
import EmployeePipelineMatrix from "../components/EmployeePipelineMatrix.jsx";
import PersonalPipelineRadar from "../components/PersonalPipelineRadar.jsx";
import FloatingMonthPicker from "../components/FloatingMonthPicker.jsx";
import SystemUpdateBanner from "../components/SystemUpdateBanner.jsx";
import PersonalizedHeroBanner from "../components/PersonalizedHeroBanner.jsx";
import CommitteeTasksList from "../components/CommitteeTasksList.jsx";
import PageHeader from "../components/ui/PageHeader";
import PageContainer from "../components/ui/PageContainer";

export default function Dashboard() {
  const { user } = useAuth();

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

  return (
    <ProtectedRoute>
      <PageContainer spaceY="10" className="pt-4">
        <SystemUpdateBanner />
        <PersonalizedHeroBanner />

        {/* PIPELINE SECTION */}
        <div className="relative">
          <PageHeader
            title={
              user?.is_head || user?.isHead
                ? "Accomplishment Report"
                : "Private Workflow"
            }
            description={
              user?.is_head || user?.isHead
                ? "Executive Performance Governance"
                : "Personal Execution Roadmap"
            }
          >
            {globalRange?.label && (
              <span className="text-mauve-11 font-bold px-3 py-1 bg-mauve-2 border border-mauve-4 rounded-xl text-lg md:text-xl shrink-0 shadow-sm">
                — {globalRange.label}
              </span>
            )}
            <FloatingMonthPicker
              selectedRange={globalRange}
              onChange={setGlobalRange}
            />
          </PageHeader>

          <div className="grid gap-14 relative mt-10">
            {user?.is_head ||
            user?.isHead ||
            user?.is_hr ||
            user?.isHr ||
            user?.isSuperAdmin ? (
              <>
                <DashboardStats selectedRange={globalRange} />
                <EmployeePipelineMatrix selectedRange={globalRange} />
              </>
            ) : (
              <PersonalPipelineRadar selectedRange={globalRange} />
            )}

            <TasksList selectedRange={globalRange} />
            <CommitteeTasksList selectedRange={globalRange} />
          </div>
        </div>
      </PageContainer>
    </ProtectedRoute>
  );
}
