import { useState, useEffect, useMemo } from "react";
import QueryError from "@/components/ui/QueryError";
import { formatDateWith } from "@/utils/formatDate";
import { Navigate } from "react-router";
import { useAuth } from "../../../context/AuthContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { groupTaskTemplateService } from "../../../services/groupTaskTemplateService";
import { employeeService } from "../../../services/employeeService";
import PageShell from "../../../components/ui/PageShell";
import EmptyState from "../../../components/ui/EmptyState";
import TabGroup from "../../../components/ui/TabGroup";
import { confirmActionToast, confirmDeleteToast } from "../../../components/ui/CustomToast";
import Spinner from "@/components/ui/Spinner";
import { Button } from "@/components/ui/button";
import { SortHead, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useTableSort } from "@/hooks/useTableSort";
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

  const { data: templates = [], isLoading, isError, refetch } = useQuery({
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

  const templateSort = useMemo(
    () => ({
      template: (t) => t.name,
      slots: (t) => (t.members || []).length,
      usage: (t) => usageStats[t.id]?.count ?? 0,
    }),
    [usageStats],
  );
  const { sorted: sortedTemplates, sort, toggle } = useTableSort(templates, templateSort);

  const archiveMutation = useMutation({
    mutationFn: (id) => groupTaskTemplateService.archiveTemplate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["groupTaskTemplates"] });
      toast.success("Template archived.");
    },
    onError: (err) => toast.error(err.message || "Could not update the template."),
  });

  const restoreMutation = useMutation({
    mutationFn: (id) => groupTaskTemplateService.restoreTemplate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["groupTaskTemplates"] });
      toast.success("Template restored.");
    },
    onError: (err) => toast.error(err.message || "Could not restore the template."),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => groupTaskTemplateService.deleteTemplate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["groupTaskTemplates"] });
      toast.success("Template deleted permanently.");
    },
    onError: (err) => toast.error(err.message || "Could not delete the template."),
  });

  if (!user) return null;
  if (!canManage) return <Navigate to="/group-tasks" replace />;

  return (
    <PageShell
      title="Group Task Templates"
      description="Reusable rosters and task structures for creating group tasks."
      action={
        <Button type="button" onClick={() => setEditingTemplateId(null)}>
          <Plus size={16} /> New Template
        </Button>
      }
      tabs={
        <TabGroup
          variant="underline"
          tabs={[
            { value: "ACTIVE", label: "Active" },
            { value: "ARCHIVED", label: "Archived" },
          ]}
          activeTab={statusFilter}
          onChange={setStatusFilter}
        />
      }
    >
      {isError ? (
        <QueryError title="Templates could not be loaded." onRetry={refetch} />
      ) : isLoading ? (
        <div className="py-20 flex justify-center">
          <Spinner size="md" />
        </div>
      ) : templates.length === 0 ? (
        <EmptyState
          icon={LayoutTemplate}
          title={statusFilter === "ARCHIVED" ? "No archived templates" : "No templates yet"}
          description={
            statusFilter === "ARCHIVED"
              ? "Archived templates will show up here."
              : "Save one from the New Group Task modal, or create one here."
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <Table tableId="task-templates">
            <TableHeader>
              <TableRow>
                <SortHead id="template" sortKey="template" sort={sort} onSort={toggle}>Template</SortHead>
                <SortHead id="slots" sortKey="slots" sort={sort} onSort={toggle}>Slots</SortHead>
                <SortHead id="usage" sortKey="usage" sort={sort} onSort={toggle}>Usage</SortHead>
                <TableHead id="actions" className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedTemplates.map((t) => {
                const stats = usageStats[t.id];
                const slotCount = (t.members || []).length;
                return (
                  <TableRow key={t.id}>
                    <TableCell className="max-w-xs truncate text-sm font-bold text-foreground">{t.name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Users size={12} /> {slotCount} slot{slotCount === 1 ? "" : "s"}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {stats
                        ? `Used ${stats.count} time${stats.count === 1 ? "" : "s"} · last ${formatDateWith(
                            stats.lastUsedAt,
                          )}`
                        : "Never used"}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => setEditingTemplateId(t.id)}
                          className="rounded-lg text-muted-foreground"
                          title="Edit"
                          aria-label="Edit"
                        >
                          <Pencil size={14} />
                        </Button>
                        {t.archived_at ? (
                          <>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => restoreMutation.mutate(t.id)}
                              className="rounded-lg text-muted-foreground"
                              title="Restore"
                              aria-label="Restore"
                            >
                              <RotateCcw size={14} />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              onClick={() =>
                                confirmDeleteToast(
                                  "Delete template permanently?",
                                  `"${t.name}" will be deleted forever. This action cannot be undone.`,
                                  () => deleteMutation.mutate(t.id),
                                )
                              }
                              className="rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                              title="Delete permanently"
                              aria-label="Delete permanently"
                            >
                              <Trash2 size={14} />
                            </Button>
                          </>
                        ) : (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            onClick={() =>
                              confirmActionToast(
                                "Archive template?",
                                `"${t.name}" will be hidden from the template picker. You can restore it later from here.`,
                                "Archive",
                                null,
                                () => archiveMutation.mutate(t.id),
                              )
                            }
                            className="rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            title="Archive"
                            aria-label="Archive"
                          >
                            <Archive size={14} />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <TemplateEditorModal
        isOpen={editingTemplateId !== undefined}
        onClose={() => setEditingTemplateId(undefined)}
        templateId={editingTemplateId || null}
        user={user}
        employees={employees}
      />
    </PageShell>
  );
}
