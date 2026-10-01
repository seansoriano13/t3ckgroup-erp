import { useState } from "react";
import { useNavigate } from "react-router";
import { Bug } from "lucide-react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AttachmentField } from "@/components/ui/Attachments";
import { useAuth } from "@/context/AuthContext";
import { useFileAttachments } from "@/hooks/useFileAttachments";
import { bugReportService, BUG_REPORT_MAX_BYTES } from "@/services/bugReportService";
import { formatBytes } from "@/utils/attachments";

/**
 * The floating "Report a bug" button on every signed-in page (CONTEXT.md →
 * Bug Report). One text box plus up to 5 files of any type, 50 MB each; a
 * screenshot pasted into the text box is attached. The page it was sent from
 * is recorded automatically. The sender gets a toast; IT may then write back
 * in the report's Notes, which the sender follows under "My reports"
 * (/bug-reports shows a non-reader only their own).
 */
export default function BugReportButton() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [isSending, setIsSending] = useState(false);
  const attachments = useFileAttachments({
    maxBytes: BUG_REPORT_MAX_BYTES,
    anyType: true,
    uploadFile: (file) => bugReportService.uploadAttachment(user?.id, file),
  });

  const busy = isSending || attachments.isUploading;

  const send = async () => {
    setIsSending(true);
    try {
      const uploaded = await attachments.upload();
      await bugReportService.submit({
        description,
        attachments: uploaded,
        pageUrl: `${window.location.pathname}${window.location.search}`,
      });
      toast.success("Bug report sent. Thank you!");
      setDescription("");
      attachments.clear();
      setOpen(false);
    } catch (err) {
      toast.error(err.message || "Could not send the bug report.");
    } finally {
      setIsSending(false);
    }
  };

  return (
    <>
      {/* Neutral, not the red main-action colour: it sits on every page and
          is never that page's main action. z-30 so a page's own bottom
          toolbar (Approvals, z-40) covers it rather than the other way round. */}
      <Button
        variant="outline"
        size="icon"
        aria-label="Report a bug"
        title="Report a bug"
        onClick={() => setOpen(true)}
        className="fixed right-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-30 size-11 rounded-full bg-card text-muted-foreground shadow-lg hover:text-foreground"
      >
        <Bug size={18} />
      </Button>

      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Report a bug</DialogTitle>
            <DialogDescription>
              What broke, and what were you doing? Paste a screenshot straight into the box.
            </DialogDescription>
          </DialogHeader>

          <Textarea
            autoFocus
            rows={6}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onPaste={attachments.addFromPaste}
            placeholder="What went wrong?"
            disabled={busy}
          />

          <AttachmentField
            attachments={attachments}
            disabled={busy}
            hint={`Optional — up to ${attachments.max} files, ${formatBytes(BUG_REPORT_MAX_BYTES)} each. Any file type.`}
          />

          <DialogFooter>
            <Button
              variant="link"
              className="mr-auto px-0 text-muted-foreground"
              disabled={busy}
              onClick={() => {
                setOpen(false);
                navigate("/bug-reports");
              }}
            >
              My reports
            </Button>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={send} disabled={busy || !description.trim()}>
              {busy ? "Sending…" : "Send"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
