import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { taskTagService, TASK_TAG_COLORS } from "../../services/taskTagService";
import { taskTagClasses } from "../../constants/taskTagColors";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Archive, RotateCcw, Plus } from "lucide-react";
import { Select } from "@/components/ui/select";

// Super Admins and heads manage the one shared vocabulary Group Tasks tag
// from (issue #205). Archiving, not deleting, so history on already-tagged
// group tasks stays intact.
export default function ManageTagsModal({ isOpen, onClose, userId }) {
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(TASK_TAG_COLORS[0]);

  const { data: tags = [] } = useQuery({
    queryKey: ["taskTags", "all"],
    queryFn: () => taskTagService.list({ includeArchived: true }),
    enabled: isOpen,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["taskTags"] });

  const createMutation = useMutation({
    mutationFn: () => taskTagService.create({ name: newName.trim(), color: newColor, createdBy: userId }),
    onSuccess: () => {
      setNewName("");
      invalidate();
      toast.success("Tag created.");
    },
    onError: (err) => toast.error(err.message),
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, name }) => taskTagService.rename(id, name),
    onSuccess: invalidate,
    onError: (err) => toast.error(err.message),
  });

  const recolorMutation = useMutation({
    mutationFn: ({ id, color }) => taskTagService.recolor(id, color),
    onSuccess: invalidate,
    onError: (err) => toast.error(err.message),
  });

  const archiveMutation = useMutation({
    mutationFn: (id) => taskTagService.archive(id),
    onSuccess: invalidate,
    onError: (err) => toast.error(err.message),
  });

  const restoreMutation = useMutation({
    mutationFn: (id) => taskTagService.restore(id),
    onSuccess: invalidate,
    onError: (err) => toast.error(err.message),
  });

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Manage Tags</DialogTitle>
        </DialogHeader>
      <div className="space-y-4 p-1">
        <div className="flex gap-2">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New tag name"
            className="flex-1"
          />
          <Select
  options={[...TASK_TAG_COLORS.map((c) => ({ value: c, label: c }))]}
  value={newColor}
  onChange={(next) => setNewColor(next)}
/>
          <Button
            type="button"
            disabled={!newName.trim() || createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            <Plus size={16} />
          </Button>
        </div>

        <div className="space-y-2 max-h-80 overflow-y-auto">
          {tags.map((tag) => (
            <div
              key={tag.id}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${tag.archived_at ? "opacity-50" : ""}`}
            >
              <span className={`h-3 w-3 rounded-full shrink-0 ${taskTagClasses(tag.color)}`} />
              <Input
                defaultValue={tag.name}
                disabled={!!tag.archived_at}
                onBlur={(e) => {
                  const name = e.target.value.trim();
                  if (name && name !== tag.name) renameMutation.mutate({ id: tag.id, name });
                }}
                className="h-auto rounded-none border-0 bg-transparent px-0 py-0 focus-visible:ring-0 focus-visible:border-0 text-sm font-semibold" containerClassName="flex-1"
              />
              <Select
  options={[...TASK_TAG_COLORS.map((c) => ({ value: c, label: c }))]}
  value={tag.color}
  onChange={(next) => recolorMutation.mutate({ id: tag.id, color: next })}
  disabled={!!tag.archived_at}
/>
              {tag.archived_at ? (
                <Button
                  type="button"
                  title="Restore"
                  onClick={() => restoreMutation.mutate(tag.id)}
                  variant="ghost" className="h-auto"
                >
                  <RotateCcw size={14} />
                </Button>
              ) : (
                <Button
                  type="button"
                  title="Archive"
                  onClick={() => archiveMutation.mutate(tag.id)}
                  variant="ghost" className="h-auto"
                >
                  <Archive size={14} />
                </Button>
              )}
            </div>
          ))}
        </div>
      </div>
      </DialogContent>
    </Dialog>
  );
}
