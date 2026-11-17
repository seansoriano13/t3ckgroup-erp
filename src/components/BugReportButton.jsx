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
 * The "Report a bug" button on every signed-in page (CONTEXT.md → Bug Report).
 * One text box plus up to 5 files of any type, 50 MB each; a screenshot pasted
 * into the text box is attached. The page it was sent from is recorded
 * automatically. The sender gets a toast; IT may then write back in the
 * report's Notes, which the sender follows under "My reports" (/bug-reports
 * shows a non-reader only their own).
 *
 * Two looks, both always on screen:
 * - `menu` (default): an outlined button in the side menu footer, which is
 *   pinned to the bottom of the menu so a long menu never scrolls it away.
 *   `collapsed` shows the icon only, for the icon rail.
 * - `icon`: a bug icon in the phone top bar, beside the bell.
 */
export default function BugReportButton({ variant = "menu", collapsed = false }) {
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
      {/* The button stays neutral (outlined, not a red fill): it sits on every
          page and is never that page's main action. Only the bug icon is
          Signal Red, so the eye finds it among the grey menu links. */}
      {variant === "icon" ? (
        <Button
          variant="ghost"
          size="icon"
          aria-label="Report a bug"
          title="Report a bug"
          onClick={() => setOpen(true)}
          className="size-10 shrink-0 text-sidebar-primary hover:text-sidebar-primary"
        >
          <Bug size={18} strokeWidth={2.4} />
        </Button>
      ) : (
        <Button
          variant="outline"
          aria-label="Report a bug"
          title="Report a bug"
          onClick={() => setOpen(true)}
          className={`h-auto w-full gap-2.5 rounded-lg border-sidebar-border bg-card py-2 laptop:py-1.5 text-[13.5px] font-semibold text-sidebar-foreground shadow-sm hover:bg-sidebar-accent hover:text-sidebar-foreground ${collapsed ? "justify-center px-2" : "justify-start px-3"}`}
        >
          <Bug size={16} strokeWidth={2.4} className="shrink-0 text-sidebar-primary" />
          {!collapsed && <span className="truncate">Report a bug</span>}
        </Button>
      )}

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
