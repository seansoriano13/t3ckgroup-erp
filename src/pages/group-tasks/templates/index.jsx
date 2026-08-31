import { useState, useEffect } from "react";
import { Navigate } from "react-router";
import { useAuth } from "../../../context/AuthContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { groupTaskTemplateService } from "../../../services/groupTaskTemplateService";
import { employeeService } from "../../../services/employeeService";
import PageHeader from "../../../components/ui/PageHeader";
import PageContainer from "../../../components/ui/PageContainer";
import TabGroup from "../../../components/ui/TabGroup";
import { confirmActionToast, confirmDeleteToast } from "../../../components/ui/CustomToast";
import Spinner from "@/components/ui/Spinner";
import toast from "react-hot-toast";
import { LayoutTemplate, Plus, Pencil, Archive, RotateCcw, Users, Trash2 } from "lucide-react";
import TemplateEditorModal from "./_components/TemplateEditorModal";

export default function GroupTaskTemplatesPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const isSuperAdmin = user?.is_super_admin === true || user?.isSuperAdmin === true;
  const isHead = user?.is_head === true || user?.isHead === true;
  const canManage = isHead || isSuperAdmin;

  const [statusFilter, setStatusFilter] = useState("ACTIVE"); // ACTIVE | ARCHIVED
  // undefined = modal closed, null = "new template", an id = editing that template
  const [editingTemplateId, setEditingTemplateId] = useState(undefined);
  const [employees, setEmployees] = useState([]);

  useEffect(() => {
    if (canManage) {
      employeeService.getAllEmployees().then(setEmployees);
    }
  }, [canManage]);

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ["groupTaskTemplates", "manage", statusFilter],
    queryFn: () =>
      groupTaskTemplateService.getTemplates({
        includeArchived: statusFilter === "ARCHIVED",
      }),
    enabled: canManage,
    select: (data) =>
      statusFilter === "ARCHIVED" ? data.filter((t) => t.archived_at) : data,
  });

  const { data: usageStats = {} } = useQuery({
    queryKey: ["groupTaskTemplateUsage"],
    queryFn: () => groupTaskTemplateService.getUsageStats(),
    enabled: canManage,
  });

  const archiveMutation = useMutation({
    mutationFn: (id) => groupTaskTemplateService.archiveTemplate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["groupTaskTemplates"] });
      toast.success("Template archived.");
    },
    onError: (err) => toast.error(err.message),
  });

  const restoreMutation = useMutation({
    mutationFn: (id) => groupTaskTemplateService.restoreTemplate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["groupTaskTemplates"] });
      toast.success("Template restored.");
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => groupTaskTemplateService.deleteTemplate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["groupTaskTemplates"] });
      toast.success("Template deleted permanently.");
    },
    onError: (err) => toast.error(err.message),
  });

  if (!user) return null;
  if (!canManage) return <Navigate to="/group-tasks" replace />;

  return (
    <PageContainer maxWidth="7xl" className="pt-4">
      <PageHeader
        title="Group Task Templates"
        description="Reusable rosters and task structures for creating group tasks."
      >
        <button
          type="button"
          onClick={() => setEditingTemplateId(null)}
          className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2.5 rounded-xl text-sm font-bold shadow-lg shadow-primary/20 hover:opacity-90 transition-opacity"
        >
          <Plus size={15} /> New Template
        </button>
      </PageHeader>

      <div className="my-6">
        <TabGroup
          tabs={[
            { value: "ACTIVE", label: "Active" },
            { value: "ARCHIVED", label: "Archived" },
          ]}
          activeTab={statusFilter}
          onChange={setStatusFilter}
        />
      </div>

      {isLoading ? (
        <div className="py-20 flex justify-center">
          <Spinner size="md" />
        </div>
      ) : templates.length === 0 ? (
        <div className="py-20 text-center bg-card border border-border border-dashed rounded-2xl">
          <LayoutTemplate size={32} className="mx-auto text-muted-foreground/50 mb-3" />
          <h3 className="text-lg font-bold text-foreground">
            {statusFilter === "ARCHIVED" ? "No Archived Templates" : "No Templates Yet"}
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            {statusFilter === "ARCHIVED"
              ? "Archived templates will show up here."
              : "Save one from the New Group Task modal, or create one here."}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {templates.map((t) => {
            const stats = usageStats[t.id];
            const slotCount = (t.members || []).length;
            return (
              <div
                key={t.id}
                className="flex items-center justify-between gap-4 bg-card border border-border rounded-xl px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-bold text-foreground truncate">{t.name}</p>
                  <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Users size={11} /> {slotCount} slot{slotCount === 1 ? "" : "s"}
                    </span>
                    <span>
                      {stats
                        ? `Used ${stats.count} time${stats.count === 1 ? "" : "s"} · last ${new Date(
                            stats.lastUsedAt,
                          ).toLocaleDateString()}`
                        : "Never used"}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => setEditingTemplateId(t.id)}
                    className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    title="Edit"
                  >
                    <Pencil size={14} />
                  </button>
                  {t.archived_at ? (
                    <>
                      <button
                        type="button"
                        onClick={() => restoreMutation.mutate(t.id)}
                        className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                        title="Restore"
                      >
                        <RotateCcw size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          confirmDeleteToast(
                            "Delete template permanently?",
                            `"${t.name}" will be deleted forever. This action cannot be undone.`,
                            () => deleteMutation.mutate(t.id),
                          )
                        }
                        className="p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                        title="Delete permanently"
                      >
                        <Trash2 size={14} />
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() =>
                        confirmActionToast(
                          "Archive template?",
                          `"${t.name}" will be hidden from the template picker. You can restore it later from here.`,
                          "Archive",
                          null,
                          () => archiveMutation.mutate(t.id),
                        )
                      }
                      className="p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                      title="Archive"
                    >
                      <Archive size={14} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <TemplateEditorModal
        isOpen={editingTemplateId !== undefined}
        onClose={() => setEditingTemplateId(undefined)}
        templateId={editingTemplateId || null}
        user={user}
        employees={employees}
      />
    </PageContainer>
  );
}
