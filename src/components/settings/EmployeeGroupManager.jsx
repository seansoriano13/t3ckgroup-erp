import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Archive, ArchiveRestore, Trash2, Users, ChevronDown, ChevronUp } from "lucide-react";
import toast from "react-hot-toast";

import ConfirmDialog from "@/components/ui/ConfirmDialog";
import PeoplePicker from "@/components/ui/PeoplePicker";
import { useAuth } from "@/context/AuthContext";
import { employeeGroupService } from "@/services/employeeGroupService";
import { SELECTOR_TYPES } from "@/utils/resolvePeople";

const inputClass =
  "w-full h-9 rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

/**
 * Issue #201 — Employee Groups in Settings, Super Admin only (the page gates
 * the section; the service and RLS refuse anyone else regardless).
 *
 * The same card pattern as LeadSourceManager. Each group opens in place with
 * a member picker, a Team picker and the live list of who it resolves to.
 */
export default function EmployeeGroupManager() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [openId, setOpenId] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);

  const { data: groups = [], isLoading } = useQuery({
    queryKey: ["employeeGroups", "all"],
    queryFn: () => employeeGroupService.list({ includeArchived: true }),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["employeeGroups"] });
  const onError = (err) => toast.error(err.message);

  const createMutation = useMutation({
    mutationFn: () => employeeGroupService.create({ name: newName, description: newDescription }, user?.id),
    onSuccess: (group) => {
      refresh();
      toast.success("Employee Group created.");
      setNewName("");
      setNewDescription("");
      setIsAdding(false);
      setOpenId(group.id);
    },
    onError,
  });

  const changeMutation = useMutation({
    mutationFn: ({ run }) => run(),
    onSuccess: refresh,
    onError,
  });
  const change = (run) => changeMutation.mutate({ run });

  const deleteMutation = useMutation({
    mutationFn: (group) => employeeGroupService.remove(group.id, user?.id),
    onSuccess: () => {
      refresh();
      toast.success("Employee Group deleted.");
      setPendingDelete(null);
    },
    onError: (err) => {
      setPendingDelete(null);
      onError(err);
    },
  });

  const active = groups.filter((g) => !g.archived_at);
  const archived = groups.filter((g) => g.archived_at);

  return (
    <div className="p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground leading-relaxed max-w-lg">
          Named sets of people any Sales Flow setting can point at. A group always means its current members —
          hand-picked people plus everyone on its Teams.
        </p>
        {!isAdding && (
          <button
            type="button"
            onClick={() => setIsAdding(true)}
            className="shrink-0 text-xs font-bold text-foreground flex items-center gap-1 hover:bg-muted px-2.5 py-1.5 rounded-lg transition-colors"
          >
            <Plus size={14} /> New Group
          </button>
        )}
      </div>

      {isAdding && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            createMutation.mutate();
          }}
          className="mb-5 grid gap-3 rounded-xl border border-border bg-muted/20 p-4 sm:grid-cols-[1fr_1.5fr_auto] sm:items-end"
        >
          <label className="space-y-1">
            <span className="text-xs font-bold text-muted-foreground">Name</span>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Purchasing" className={inputClass} required />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-bold text-muted-foreground">Description (optional)</span>
            <input value={newDescription} onChange={(e) => setNewDescription(e.target.value)} className={inputClass} />
          </label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsAdding(false)}
              className="h-9 px-3 rounded-lg border border-border text-muted-foreground hover:bg-muted text-sm font-semibold transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              Create
            </button>
          </div>
        </form>
      )}

      {isLoading ? (
        <p className="py-6 text-center text-sm text-muted-foreground animate-pulse">Loading Employee Groups...</p>
      ) : groups.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No Employee Groups yet.</p>
      ) : (
        <div className="space-y-2.5">
          {[...active, ...archived].map((group) => (
            <GroupCard
              // Re-keyed on the saved details so the inputs start from them again after a save.
              key={`${group.id}:${group.name}:${group.description ?? ""}`}
              group={group}
              isOpen={openId === group.id}
              onToggle={() => setOpenId(openId === group.id ? null : group.id)}
              busy={changeMutation.isPending}
              onRename={(patch) => change(() => employeeGroupService.rename(group.id, patch, user?.id))}
              onSetMembers={(ids) => change(() => employeeGroupService.setMembers(group.id, ids, user?.id))}
              onSetTeams={(teams) => change(() => employeeGroupService.setTeams(group.id, teams, user?.id))}
              onArchive={() => change(() => employeeGroupService.archive(group.id, user?.id))}
              onRestore={() => change(() => employeeGroupService.restore(group.id, user?.id))}
              onDelete={() => setPendingDelete(group)}
            />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title={`Delete "${pendingDelete?.name}"?`}
        description="Deleting is refused while any Sales Flow or published version still uses this group. Archive it instead to hide it from pickers."
        confirmLabel="Delete"
        tone="destructive"
        confirmDisabled={deleteMutation.isPending}
        onConfirm={() => pendingDelete && deleteMutation.mutate(pendingDelete)}
      />
    </div>
  );
}

function GroupCard({ group, isOpen, onToggle, busy, onRename, onSetMembers, onSetTeams, onArchive, onRestore, onDelete }) {
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description || "");
  const isArchived = Boolean(group.archived_at);
  const detailsChanged = name.trim() !== group.name || (description.trim() || null) !== (group.description || null);

  return (
    <div className={`rounded-xl border border-border ${isArchived ? "bg-muted/20 opacity-70" : "bg-card"}`}>
      <button type="button" onClick={onToggle} className="flex w-full items-center justify-between gap-3 p-3 text-left">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Users size={15} />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-foreground">
              {group.name}
              {isArchived && <span className="ml-2 text-[10px] font-semibold uppercase text-muted-foreground">Archived</span>}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {group.memberIds.length} {group.memberIds.length === 1 ? "person" : "people"}
              {group.description ? ` · ${group.description}` : ""}
            </p>
          </div>
        </div>
        {isOpen ? <ChevronUp size={16} className="text-muted-foreground" /> : <ChevronDown size={16} className="text-muted-foreground" />}
      </button>

      {isOpen && (
        <div className="space-y-4 border-t border-border p-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_1.5fr_auto] sm:items-end">
            <label className="space-y-1">
              <span className="text-xs font-bold text-muted-foreground">Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-bold text-muted-foreground">Description</span>
              <input value={description} onChange={(e) => setDescription(e.target.value)} className={inputClass} />
            </label>
            <button
              type="button"
              disabled={!detailsChanged || busy}
              onClick={() => onRename({ name, description })}
              className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              Save
            </button>
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-bold text-muted-foreground">Hand-picked people</p>
            <PeoplePicker
              types={[SELECTOR_TYPES.EMPLOYEE]}
              placeholder="Add person"
              disabled={busy}
              value={group.employeeIds.map((id) => ({ type: SELECTOR_TYPES.EMPLOYEE, id }))}
              onChange={(selectors) => onSetMembers(selectors.map((s) => s.id))}
            />
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-bold text-muted-foreground">Whole Teams</p>
            <PeoplePicker
              types={[SELECTOR_TYPES.TEAM]}
              placeholder="Add Team"
              disabled={busy}
              value={group.teams.map((team) => ({ type: SELECTOR_TYPES.TEAM, team }))}
              onChange={(selectors) => onSetTeams(selectors.map((s) => s.team))}
            />
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-bold text-muted-foreground">
              Resolves to {group.memberIds.length} {group.memberIds.length === 1 ? "person" : "people"} today
            </p>
            {group.members.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nobody yet.</p>
            ) : (
              <ul className="flex flex-wrap gap-1.5">
                {group.members.map((m) => (
                  <li key={m.id} className="rounded-md bg-muted/50 px-2 py-0.5 text-xs text-foreground">
                    {m.name}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-3">
            {isArchived ? (
              <button type="button" disabled={busy} onClick={onRestore} className="h-8 px-3 rounded-lg border border-border text-xs font-semibold hover:bg-muted flex items-center gap-1.5">
                <ArchiveRestore size={14} /> Restore
              </button>
            ) : (
              <button type="button" disabled={busy} onClick={onArchive} className="h-8 px-3 rounded-lg border border-border text-xs font-semibold hover:bg-muted flex items-center gap-1.5">
                <Archive size={14} /> Archive
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={onDelete}
              className="h-8 px-3 rounded-lg border border-destructive/30 text-xs font-semibold text-destructive hover:bg-destructive/10 flex items-center gap-1.5"
            >
              <Trash2 size={14} /> Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
