import { FileInput } from "@/components/ui/FileInput";
import { KeyRound, Lock, Paperclip, Send, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import Spinner from "../../ui/Spinner";
import Avatar from "../../Avatar";
import { AttachmentPreviews, AttachmentList } from "../../ui/Attachments";
import { MAX_ATTACHMENT_BYTES, formatBytes, ALLOWED_EXTENSIONS_STRING } from "../../../utils/attachments";
import MentionTextarea, { NoteText } from "../../ui/MentionTextarea";
import { Button } from "../../ui/button";
import TaskCreatedNoteCard from "./TaskCreatedNoteCard";
import SystemNoteChanges from "./SystemNoteChanges";
import { withHiddenVisits } from "../../../utils/sorHiddenVisits";

function ProcurementLogNoteCard({ metadata }) {
  if (!metadata) return null;
  return (
    <div className="mt-1.5 rounded-xl border border-border/80 bg-card p-3 shadow-xs space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="truncate text-xs font-bold text-foreground">
          {metadata.requested_name || "Product"}
        </span>
      </div>
    </div>
  );
}

function formatWhen(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * #475: where a Stage Visit the viewer cannot read would sit in the timeline.
 * Says which Stage and why, so "where are the notes?" answers itself.
 */
function HiddenVisitRow({ visit }) {
  return (
    <li className="flex items-center gap-2 py-1 text-[11px] text-muted-foreground/80">
      <Lock size={11} className="shrink-0" aria-hidden />
      <span className="h-px flex-1 bg-border/60" aria-hidden />
      <span className="shrink-0">
        Notes from <span className="font-semibold text-muted-foreground">{visit.stageName || "another Stage"}</span>
        {visit.reason === "restricted" ? " · restricted" : " · not shared with you"}
      </span>
      <span className="h-px flex-1 bg-border/60" aria-hidden />
    </li>
  );
}

/**
 * The SOR's Log Notes / chat: notes list plus the composer (mentions,
 * attachments). Moved out of the old flat modal unchanged — this ticket
 * (#298) only relocates it, it doesn't redesign it.
 */
export default function SorChatColumn({
  notes,
  hiddenVisits = [],
  loadingNotes,
  notesContainerRef,
  handleMentionClick,
  note,
  setNote,
  noteMentions,
  setNoteMentions,
  mentionAccessHint = null,
  employees,
  attachments,
  fileInputRef,
  isPosting,
  handlePostNote,
}) {
  const { files, isUploading } = attachments;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
        <p className="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
          Activity & Log Notes
        </p>
        <span className="text-[11px] font-semibold text-muted-foreground tabular-nums">
          {notes.length} note{notes.length === 1 ? "" : "s"}
        </span>
      </div>

      <div
        ref={notesContainerRef}
        className="min-h-0 flex-1 overflow-y-auto custom-scrollbar px-4 py-3"
      >
        {loadingNotes ? (
          <Spinner size="sm" />
        ) : notes.length === 0 && hiddenVisits.length === 0 ? (
          <p className="text-xs text-muted-foreground/70 italic py-4 text-center">No notes yet.</p>
        ) : (
          <ul className="space-y-3">
            {withHiddenVisits(notes, hiddenVisits).map(({ kind, note: n, visit }) =>
              kind === "hidden" ? (
                <HiddenVisitRow key={`hidden-${visit.id}`} visit={visit} />
              ) : (
                <li key={n.id} className="flex gap-2.5">
                  {n.type === "SYSTEM" ? (
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                      <Sparkles size={12} />
                    </div>
                  ) : (
                    <Avatar name={n.author?.name} src={n.author?.avatar_path} size="sm" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-semibold text-muted-foreground">
                      {n.author?.name ? (
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => handleMentionClick(n.author)}
                          className="h-auto inline-block p-0 text-left font-semibold text-muted-foreground hover:bg-transparent hover:text-foreground"
                          title={`Click to mention @${n.author.name}`}
                        >
                          {n.author.name}
                        </Button>
                      ) : (
                        <span>{n.type === "SYSTEM" ? "System" : "Unknown"}</span>
                      )}
                      <span className="font-normal text-muted-foreground/60">
                        {" · "}
                        {formatWhen(n.created_at)}
                      </span>
                    </p>
                    {n.metadata?.event === "PROCUREMENT_UPDATE" ? (
                      <ProcurementLogNoteCard metadata={n.metadata} />
                    ) : n.metadata?.event === "STAGE_ACTION_TASK_CREATED" ? (
                      <TaskCreatedNoteCard note={n} />
                    ) : n.type === "SYSTEM" && n.metadata?.changes?.length > 0 ? (
                      <SystemNoteChanges metadata={n.metadata} />
                    ) : (
                      n.content && (
                        <NoteText
                          content={n.content}
                          mentions={n.metadata?.mentions}
                          onMentionClick={handleMentionClick}
                          className={cn(
                            "text-sm break-words",
                            n.type === "SYSTEM" ? "text-muted-foreground italic" : "text-foreground",
                          )}
                        />
                      )
                    )}
                    <AttachmentList
                      attachments={n.metadata?.attachments}
                      className={n.content ? "mt-2" : "mt-1"}
                    />
                  </div>
                </li>
              ),
            )}
          </ul>
        )}
      </div>

      <div className="shrink-0 border-t border-border/50 px-4 py-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handlePostNote();
          }}
        >
          <FileInput
            ref={fileInputRef}
            multiple
            accept={ALLOWED_EXTENSIONS_STRING}
            onFiles={attachments.addFiles}
          />

          {files.length > 0 && (
            <div className="mb-2">
              <AttachmentPreviews
                files={files}
                onRemove={attachments.removeFile}
                disabled={isPosting}
              />
            </div>
          )}

          <div className="flex items-end gap-2">
            <div className="flex-1 rounded-xl border border-border/80 bg-muted/25 p-3 focus-within:border-mauve-7 focus-within:bg-card">
              <MentionTextarea
                rows={2}
                value={note}
                onChange={setNote}
                people={employees}
                mentions={noteMentions}
                onMentionsChange={setNoteMentions}
                onPaste={attachments.addFromPaste}
                placeholder="Add a note — type @ to mention someone"
                className="w-full resize-none bg-transparent text-sm font-medium text-foreground placeholder:text-muted-foreground/50 outline-none"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              size="icon"
              title={`Attach files (max ${attachments.max})`}
              disabled={isPosting || files.length >= attachments.max}
              onClick={() => fileInputRef.current?.open()}
              className="h-10 w-10 shrink-0 rounded-xl text-muted-foreground"
            >
              <Paperclip size={15} />
            </Button>
            <Button
              type="submit"
              disabled={(!note.trim() && files.length === 0) || isPosting}
              className="h-10 shrink-0 gap-1.5 rounded-xl px-4 text-[13px]"
            >
              {isPosting ? <Spinner size="sm" /> : <Send size={13} />}
              {isUploading ? "Uploading" : "Post"}
            </Button>
          </div>
          {mentionAccessHint && (
            <p className="mt-1.5 flex items-center gap-1 text-[11px] font-medium text-violet-11" role="status">
              <KeyRound size={11} className="shrink-0" aria-hidden />
              {mentionAccessHint}
            </p>
          )}
          <p className="mt-1.5 text-[10px] text-muted-foreground/70">
            Type <span className="font-bold">@</span> to mention someone · attach or paste up to{" "}
            {attachments.max} files — {formatBytes(MAX_ATTACHMENT_BYTES)} each.
          </p>
        </form>
      </div>
    </div>
  );
}
