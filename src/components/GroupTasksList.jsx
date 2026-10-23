import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../context/AuthContext";
import { groupTaskService } from "../services/groupTaskService";
import {
  Users,
  Search,
  X,
  List,
  LayoutGrid,
  Rows3,
} from "lucide-react";
import { Link } from "react-router";
import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import GroupTaskCard from "../pages/group-tasks/_components/GroupTaskCard";
import SectionHeader from "./ui/SectionHeader";
import { Input } from "@/components/ui/input";

export default function GroupTasksList({ selectedRange }) {
  const { user } = useAuth();
  const isSuperAdmin =
    user?.is_super_admin === true || user?.isSuperAdmin === true;
  const isHead = user?.is_head === true || user?.isHead === true;

  const [searchTerm, setSearchTerm] = useState("");
  const [layoutMode, setLayoutMode] = useState("row"); // "row" | "stack" | "grid"

  const { data: groupTasks = [], isLoading } = useQuery({
    queryKey: ["groupTasks", user?.id],
    queryFn: () =>
      groupTaskService.getGroupTasks(user?.id, isHead, isSuperAdmin),
    enabled: !!user?.id,
  });

  const activeTasks = useMemo(() => {
    const tasks = groupTasks.filter(
      (t) =>
        t.status === "ACTIVE" ||
        t.status === "PENDING" ||
        t.status === "COMPLETED",
    );

    if (!searchTerm.trim()) return tasks;
    const lower = searchTerm.toLowerCase();
    return tasks.filter(
      (t) =>
        t.title.toLowerCase().includes(lower) ||
        t.description?.toLowerCase().includes(lower),
    );
  }, [groupTasks, searchTerm]);

  if (isLoading) return null;
  if (groupTasks.length === 0) return null;

  return (
    <section className="space-y-6 mt-8 w-full min-w-0">
      <SectionHeader
        title="Group tasks"
        description="Active group assignments"
        rangeLabel={selectedRange?.label || "This Range"}
      >
        <div className="flex items-center gap-3 flex-wrap">
          {/* SEARCH */}
          <div className="flex items-center gap-2 bg-card border border-border rounded-lg px-3 py-1.5 min-w-[200px]">
            <Search size={14} className="text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search tasks..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              containerClassName="w-full" className="border-0 bg-transparent rounded-none px-0 py-0 shadow-none focus-visible:ring-0 h-auto bg-transparent border-none outline-none text-xs text-foreground placeholder-muted-foreground"
            />
            {searchTerm && (
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => setSearchTerm("")}
                className="h-auto w-auto text-muted-foreground hover:text-foreground hover:bg-transparent"
              >
                <X size={12} />
              </Button>
            )}
          </div>

          {/* LAYOUT TOGGLE */}
          <div className="flex items-center gap-1.5 bg-mauve-2 border border-mauve-5 p-1 rounded-lg">
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setLayoutMode("row")}
              className={`h-auto w-auto p-1 rounded transition-all ${layoutMode === "row" ? "bg-card shadow-sm text-red-9 hover:bg-card" : "text-muted-foreground hover:text-mauve-11 hover:bg-transparent"}`}
              title="Single Row"
            >
              <List size={16} />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setLayoutMode("stack")}
              className={`h-auto w-auto p-1 rounded transition-all ${layoutMode === "stack" ? "bg-card shadow-sm text-red-9 hover:bg-card" : "text-muted-foreground hover:text-mauve-11 hover:bg-transparent"}`}
              title="3-Row Stack"
            >
              <Rows3 size={16} />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setLayoutMode("grid")}
              className={`h-auto w-auto p-1 rounded transition-all ${layoutMode === "grid" ? "bg-card shadow-sm text-red-9 hover:bg-card" : "text-muted-foreground hover:text-mauve-11 hover:bg-transparent"}`}
              title="Full Grid"
            >
              <LayoutGrid size={16} />
            </Button>
          </div>

          {/* VIEW ALL */}
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            asChild
          >
            <Link to="/group-tasks">View All</Link>
          </Button>
        </div>
      </SectionHeader>

      {/* DYNAMIC GRID CONTAINER */}
      {activeTasks.length > 0 ? (
        <div className="w-full min-w-0 overflow-hidden">
          <div
            className={`
            ${layoutMode === "row" ? "flex gap-3 overflow-x-auto pb-4 custom-scrollbar snap-x" : ""}
            ${layoutMode === "stack" ? "grid grid-rows-3 grid-flow-col gap-3 overflow-x-auto pb-4 custom-scrollbar snap-x" : ""}
            ${layoutMode === "grid" ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 pb-4" : ""}
          `}
          >
            {activeTasks.map((task) => (
              <div
                key={task.id}
                className={`${
                  layoutMode === "grid"
                    ? "w-full min-w-0"
                    : "w-[300px] sm:w-[340px] max-w-[85vw] snap-start shrink-0"
                }`}
              >
                <GroupTaskCard
                  task={task}
                  currentUserId={user?.id}
                  isSuperAdmin={isSuperAdmin}
                  searchTerm={searchTerm}
                  onView={() => {
                    window.dispatchEvent(
                      new CustomEvent("OPEN_ENTITY_DETAILS", {
                        detail: { id: task.id, type: "GROUP_TASK" },
                      }),
                    );
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center p-12 text-center bg-card border border-border border-dashed rounded-[2rem] shadow-sm">
          <div className="w-16 h-16 rounded-full bg-mauve-3 flex items-center justify-center text-mauve-9 mb-4">
            <Search size={32} />
          </div>
          <p className="font-bold text-lg text-foreground">No tasks found</p>
          <p className="text-sm max-w-xs text-muted-foreground mt-2">
            Try adjusting your search or layout
          </p>
        </div>
      )}
    </section>
  );
}
