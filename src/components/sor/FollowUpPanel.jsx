import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Clock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { opportunityService } from "@/services/opportunityService";
import { storageService } from "@/services/storageService";
import { isAllowedAttachment, ALLOWED_EXTENSIONS_STRING } from "@/utils/attachments";
import { formatTaskDateTime } from "@/utils/formatDate";

/**
 * Issue #204 Part 3, stories 27/30 — "Next reminder …" plus a "Log
 * follow-up" button under the SOR's current Stage. `status` (the current
 * Stage's cadence plus its next due date) is fetched by `StageChecklist`,
 * which is also what decides whether to render this panel at all — kept
 * that way so the "nothing configured" empty state (no checklist, no
 * fields, no cadence) stays a single decision made in one place.
 */
export default function FollowUpPanel({ opportunity, actorId, onChanged, status }) {
  const opportunityId = opportunity?.id;
  const stageCode = opportunity?.flow_stage_id || opportunity?.status;
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);

  const logMutation = useMutation({
    mutationFn: async () => {
      let attachments = [];
      if (file) {
        setUploading(true);
        try {
          const uploaded = await storageService.uploadFileToCloudinary(file);
          attachments = [uploaded];
        } finally {
          setUploading(false);
        }
      }
      return opportunityService.logFollowUp(opportunityId, { note, attachments }, actorId);
    },
    onSuccess: () => {
      toast.success("Follow-up logged.");
      setOpen(false);
      setNote("");
      setFile(null);
      queryClient.invalidateQueries({ queryKey: ["followUpStatus", opportunityId, stageCode] });
      queryClient.invalidateQueries({ queryKey: ["opportunityNotes", opportunityId] });
      onChanged?.();
    },
    onError: (err) => toast.error(err.message),
  });

  if (!status?.cadence) return null; // defensive: StageChecklist already gates on this

  return (
    <div className="flex items-center justify-between rounded-xl border border-border/70 bg-card/50 px-4 py-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Clock size={13} />
        {status.nextDue
          ? `Next reminder due ${formatTaskDateTime(status.nextDue)}`
          : "Follow-up Cadence active"}
      </div>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Log follow-up
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Log follow-up</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Textarea
              placeholder="What happened? (optional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <input
              type="file"
              accept={ALLOWED_EXTENSIONS_STRING}
              onChange={(e) => {
                const picked = e.target.files?.[0] || null;
                if (picked && !isAllowedAttachment(picked)) {
                  toast.error("That file type isn't supported.");
                  return;
                }
                setFile(picked);
              }}
            />
            {status.cadence.proofRequired !== false && (
              <p className="text-xs text-muted-foreground">This cadence requires a file as proof.</p>
            )}
          </div>
          <DialogFooter>
            <Button
              onClick={() => logMutation.mutate()}
              disabled={logMutation.isPending || uploading}
            >
              {uploading || logMutation.isPending ? "Logging…" : "Log follow-up"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
