import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { groupRoleService } from "../../../services/groupRoleService";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  ChevronDown,
  X,
  Edit3,
  Trash2,
  Check,
  Plus,
  AlertCircle,
} from "lucide-react";
import Spinner from "@/components/ui/Spinner";
import toast from "react-hot-toast";
import { confirmDeleteToast } from "../../../components/ui/CustomToast";

export default function GroupRoleManagerModal({ isOpen, onClose }) {
  const queryClient = useQueryClient();
  const [newRole, setNewRole] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState("");

  useEffect(() => {
    if (isOpen) {
      // Resetting on open is the point: the modal keeps its fields mounted
      // between openings, so without this the next open shows the last
      // session's input. isOpen is the external event being followed.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setNewRole("");
      setEditingId(null);
      setEditValue("");
    }
  }, [isOpen]);

  // Keyboard shortcut
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  const { data: roles = [], isLoading } = useQuery({
    queryKey: ["groupRoles"],
    queryFn: groupRoleService.getRoles,
    enabled: isOpen,
  });

  const addMutation = useMutation({
    mutationFn: (name) => groupRoleService.addRole(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["groupRoles"] });
      setNewRole("");
      toast.success("Role added.");
    },
    onError: (err) => toast.error(err.message),
  });

  const editMutation = useMutation({
    mutationFn: ({ id, name }) => groupRoleService.updateRole(id, name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["groupRoles"] });
      setEditingId(null);
      toast.success("Role updated.");
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => groupRoleService.deleteRole(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["groupRoles"] });
      toast.success("Role deleted.");
    },
    onError: (err) => toast.error(err.message),
  });

  const handleAdd = (e) => {
    e.preventDefault();
    const trimmed = newRole.trim().toUpperCase();
    if (!trimmed) return;

    // Check if duplicate
    if (roles.some((r) => r.role_name === trimmed)) {
      toast.error("Role already exists.");
      return;
    }

    addMutation.mutate(trimmed);
  };

  const handleSaveEdit = (id) => {
    const trimmed = editValue.trim().toUpperCase();
    if (!trimmed) {
      setEditingId(null);
      return;
    }

    // Check if duplicate
    if (roles.some((r) => r.role_name === trimmed && r.id !== id)) {
      toast.error("Role already exists.");
      return;
    }

    editMutation.mutate({ id, name: trimmed });
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="p-0 gap-0 z-[80] shadow-[0_10px_40px_-10px_rgba(79,70,229,0.15)] flex flex-col w-[500px] sm:max-w-none max-w-[95vw] max-h-[85vh] rounded-2xl overflow-hidden"
      >
        {/* HEADER */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-border/60 shrink-0">
          <div className="flex items-center gap-2.5 text-xs text-muted-foreground">
            <div className="w-[18px] h-[18px] rounded bg-primary flex items-center justify-center text-primary-foreground text-[9px] font-bold">
              R
            </div>
            <ChevronDown
              size={11}
              className="text-muted-foreground/50 rotate-[-90deg]"
            />
            <span className="font-medium text-muted-foreground/80">
              Manage Group Roles
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
          >
            <X size={15} />
          </button>
        </div>

        {/* BODY */}
        <div className="flex-1 overflow-y-auto min-h-0 flex flex-col bg-muted/10">
          <div className="p-5 flex-1">
            <h3 className="text-sm font-bold text-foreground mb-1">
              Group Roles
            </h3>
            <p className="text-xs text-muted-foreground mb-4">
              Add or modify standard roles for group task assignments. Changes
              apply globally.
            </p>

            <div className="space-y-2">
              {isLoading ? (
                <div className="flex justify-center py-6">
                  <Spinner size="sm" />
                </div>
              ) : roles.length === 0 ? (
                <div className="py-6 text-center text-xs text-muted-foreground italic border border-dashed border-border rounded-xl">
                  No roles defined.
                </div>
              ) : (
                roles.map((role) => (
                  <div
                    key={role.id}
                    className="flex items-center justify-between bg-card border border-border rounded-xl p-2 group/item hover:bg-muted/30 transition-colors"
                  >
                    {editingId === role.id ? (
                      <div className="flex-1 flex items-center gap-2">
                        <input
                          type="text"
                          value={editValue}
                          onChange={(e) =>
                            setEditValue(e.target.value.toUpperCase())
                          }
                          className="flex-1 bg-background border border-border rounded-lg px-3 py-1.5 text-xs text-foreground outline-none focus:border-primary focus:ring-1 ring-mauve-6"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleSaveEdit(role.id);
                            if (e.key === "Escape") setEditingId(null);
                          }}
                        />
                        <button
                          onClick={() => handleSaveEdit(role.id)}
                          disabled={editMutation.isPending}
                          className="p-1.5 rounded-md text-green-600 hover:bg-green-500/10 transition-colors"
                        >
                          {editMutation.isPending &&
                          editMutation.variables?.id === role.id ? (
                            <Spinner size="xs" />
                          ) : (
                            <Check size={15} />
                          )}
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="p-1.5 rounded-md text-muted-foreground hover:bg-muted transition-colors"
                        >
                          <X size={15} />
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="px-2 py-0.5 rounded-full bg-mauve-3 text-mauve-11 text-[11px] font-bold tracking-wider">
                          {role.role_name}
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover/item:opacity-100 transition-opacity">
                          {role.role_name === "OTHERS" && (
                            <div className="px-2 text-[10px] text-muted-foreground italic flex items-center gap-1">
                              <AlertCircle size={10} /> Reserved
                            </div>
                          )}
                          {role.role_name !== "OTHERS" && (
                            <>
                              <button
                                onClick={() => {
                                  setEditingId(role.id);
                                  setEditValue(role.role_name);
                                }}
                                className="p-1.5 text-muted-foreground hover:text-foreground transition-colors"
                                title="Edit Role"
                              >
                                <Edit3 size={13} />
                              </button>
                              <button
                                onClick={() => {
                                  confirmDeleteToast(
                                    "Delete Role?",
                                    `Are you sure you want to delete ${role.role_name}?`,
                                    () => deleteMutation.mutate(role.id),
                                  );
                                }}
                                className="p-1.5 text-muted-foreground hover:text-destructive transition-colors"
                                title="Delete Role"
                              >
                                <Trash2 size={13} />
                              </button>
                            </>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* ADD ROLE FORM */}
          <div className="p-4 border-t border-border bg-card">
            <form onSubmit={handleAdd} className="flex gap-2">
              <input
                type="text"
                placeholder="New Role Name (e.g. MARKETING)"
                value={newRole}
                onChange={(e) => setNewRole(e.target.value.toUpperCase())}
                className="flex-1 bg-background border border-border rounded-xl px-3 py-2 text-xs text-foreground outline-none focus:border-primary focus:ring-1 ring-primary/20"
              />
              <Button
                type="submit"
                disabled={!newRole.trim() || addMutation.isPending}
                className="h-[38px] px-4 rounded-xl shadow-sm text-xs font-bold"
              >
                {addMutation.isPending ? (
                  <Spinner size="sm" />
                ) : (
                  <Plus size={14} className="mr-1" />
                )}{" "}
                Add
              </Button>
            </form>
          </div>
        </div>

        {/* FOOTER */}
        <div className="px-5 py-3 border-t border-border bg-muted/30 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <kbd className="px-1.5 py-0.5 bg-muted/80 border border-border rounded font-sans text-[9px]">
              Esc
            </kbd>
            <span>to close</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="text-[12px] font-bold text-muted-foreground/80 hover:text-foreground h-8 rounded-lg px-4"
          >
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
