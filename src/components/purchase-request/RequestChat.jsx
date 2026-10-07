import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { MessagesSquare, Paperclip, Send, Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import Avatar from "@/components/Avatar";
import EmptyState from "@/components/ui/EmptyState";
import Spinner from "@/components/ui/Spinner";
import { Button } from "@/components/ui/button";
import { FileInput } from "@/components/ui/FileInput";
import { AttachmentList, AttachmentPreviews } from "@/components/ui/Attachments";
import MentionTextarea, { NoteText } from "@/components/ui/MentionTextarea";
import { useFileAttachments } from "@/hooks/useFileAttachments";
import { useTableRealtime } from "@/hooks/useTableRealtime";
import { getPermissionContext } from "@/utils/permissions";
import { ALLOWED_EXTENSIONS_STRING } from "@/utils/attachments";
import { purchaseRequestService } from "@/services/purchaseRequestService";
import { purchaseRequestKeys } from "./queryKeys";

function formatWhen(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function Message({ message }) {
  const isEvent = !!message.metadata?.event;
  return (
    <li className="flex gap-2.5" data-testid="request-message">
      {isEvent || !message.author ? (
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Sparkles size={12} />
        </div>
      ) : (
        <Avatar name={message.author.name} src={message.author.avatar_path} size="sm" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold text-muted-foreground">
          {message.author?.name || "System"}
          <span className="font-normal text-muted-foreground/60">
            {" · "}
            {formatWhen(message.created_at)}
          </span>
        </p>
        <NoteText
          content={message.content}
          mentions={message.metadata?.mentions}
          className={cn("text-sm break-words", isEvent ? "text-muted-foreground italic" : "text-foreground")}
        />
        <AttachmentList attachments={message.metadata?.attachments} className={message.content ? "mt-2" : "mt-1"} />
      </div>
    </li>
  );
}

/**
 * Issue #307 — a Purchase Request's own Chat. Self-contained, for the request
 * view (#308) to mount: `request` needs `id`. Members read and post; anyone
 * else who can see the request (purchasing, on an unassigned one) reads only.
 * Mentions pick from the request's members. Every item, member and Buyer
 * change posts here too, so the thread is the request's whole history.
 *
 * Who is notified is the database's call (a trigger on every message): the
 * people mentioned always; otherwise the Buyer and the requesters.
 */
export default function RequestChat({ request, className = "" }) {
  const requestId = request?.id;
  const { user } = useAuth();
  const { isSuperAdmin } = getPermissionContext(user);
  const queryClient = useQueryClient();
  const attachments = useFileAttachments();
  const { files, isUploading } = attachments;
  const fileInputRef = useRef(null);
  const listRef = useRef(null);
  const [text, setText] = useState("");
  const [mentions, setMentions] = useState([]);

  // Every change in any request nudges this channel; refetching one thread is cheap.
  useTableRealtime("purchase_request_messages", {
    invalidateKeys: requestId ? [purchaseRequestKeys.all(requestId)] : [],
    debounceMs: 300,
  });

  const messagesQuery = useQuery({
    queryKey: purchaseRequestKeys.messages(requestId),
    queryFn: () => purchaseRequestService.listMessages(requestId),
    enabled: !!requestId,
  });
  const { data: members = [] } = useQuery({
    queryKey: purchaseRequestKeys.members(requestId),
    queryFn: () => purchaseRequestService.listMembers(requestId),
    enabled: !!requestId,
  });

  const messages = messagesQuery.data || [];
  const canPost = isSuperAdmin || members.some((m) => m.id === user?.id);
  const people = members.filter((m) => m.id !== user?.id);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages.length]);

  const postMutation = useMutation({
    mutationFn: ({ content, uploaded }) =>
      purchaseRequestService.postMessage(requestId, user?.id, content, { attachments: uploaded, mentions }),
    onSuccess: () => {
      setText("");
      setMentions([]);
      attachments.clear();
    },
    onError: (err) => toast.error(err.message),
    onSettled: () => queryClient.invalidateQueries({ queryKey: purchaseRequestKeys.messages(requestId) }),
  });
  const isPosting = isUploading || postMutation.isPending;

  const handlePost = async () => {
    const content = text.trim();
    if ((!content && files.length === 0) || isPosting) return;
    let uploaded = [];
    try {
      uploaded = await attachments.upload();
    } catch (err) {
      toast.error(`Upload failed: ${err.message}`);
      return;
    }
    postMutation.mutate({ content, uploaded });
  };

  return (
    <section className={cn("flex min-h-0 flex-col", className)} aria-label="Request chat">
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
        <h3 className="text-sm font-semibold text-foreground">Chat</h3>
        <span className="text-[11px] font-semibold text-muted-foreground tabular-nums">
          {members.length} member{members.length === 1 ? "" : "s"}
        </span>
      </div>

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto custom-scrollbar px-4 py-3">
        {messagesQuery.isLoading ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : messagesQuery.isError ? (
          <p className="py-8 text-center text-sm text-destructive">Couldn&apos;t load the chat.</p>
        ) : messages.length === 0 ? (
          <EmptyState
            icon={MessagesSquare}
            title="No messages yet"
            description="This project's buying talk stays here, apart from the SOR's chat."
            className="py-10"
          />
        ) : (
          <ul className="space-y-3">
            {messages.map((m) => (
              <Message key={m.id} message={m} />
            ))}
          </ul>
        )}
      </div>

      {canPost ? (
        <form
          className="shrink-0 border-t border-border/50 px-4 py-3"
          onSubmit={(e) => {
            e.preventDefault();
            handlePost();
          }}
        >
          <FileInput ref={fileInputRef} multiple accept={ALLOWED_EXTENSIONS_STRING} onFiles={attachments.addFiles} />
          {files.length > 0 && (
            <div className="mb-2">
              <AttachmentPreviews files={files} onRemove={attachments.removeFile} disabled={isPosting} />
            </div>
          )}
          <div className="flex items-end gap-2">
            <div className="flex-1 rounded-xl border border-border/80 bg-muted/25 p-3 focus-within:border-mauve-7 focus-within:bg-card">
              <MentionTextarea
                rows={2}
                value={text}
                onChange={setText}
                people={people}
                mentions={mentions}
                onMentionsChange={setMentions}
                onPaste={attachments.addFromPaste}
                placeholder="Message the request — type @ to mention a member"
                className="w-full resize-none bg-transparent text-sm font-medium text-foreground placeholder:text-muted-foreground/50 outline-none"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              size="icon"
              title={`Attach files (max ${attachments.max})`}
              aria-label="Attach files"
              disabled={isPosting || files.length >= attachments.max}
              onClick={() => fileInputRef.current?.open()}
              className="h-10 w-10 shrink-0 rounded-xl text-muted-foreground"
            >
              <Paperclip size={15} />
            </Button>
            <Button
              type="submit"
              disabled={(!text.trim() && files.length === 0) || isPosting}
              className="h-10 shrink-0 gap-1.5 rounded-xl px-4 text-[13px]"
            >
              {isPosting ? <Spinner size="sm" /> : <Send size={13} />}
              {isUploading ? "Uploading" : "Post"}
            </Button>
          </div>
        </form>
      ) : (
        <p className="shrink-0 border-t border-border/50 px-4 py-3 text-xs text-muted-foreground">
          Only the request&apos;s members can post here.
        </p>
      )}
    </section>
  );
}
