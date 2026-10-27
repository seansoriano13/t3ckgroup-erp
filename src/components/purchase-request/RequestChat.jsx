import { memo, useEffect, useRef, useState } from "react";
import QueryError from "@/components/ui/QueryError";
import { formatDateWith } from "@/utils/formatDate";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Clock, MessagesSquare, Paperclip, Send, Sparkles } from "lucide-react";
import EmojiPicker from "@/components/ui/EmojiPicker";

import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import Avatar from "@/components/Avatar";
import EmptyState from "@/components/ui/EmptyState";
import Spinner from "@/components/ui/Spinner";
import { Button } from "@/components/ui/button";
import { FileInput } from "@/components/ui/FileInput";
import { AttachmentList, AttachmentPreviews } from "@/components/ui/Attachments";
import MentionTextarea, { NoteText } from "@/components/ui/MentionTextarea";
import ChatScroller from "@/components/ui/ChatScroller";
import { useFileAttachments } from "@/hooks/useFileAttachments";
import { usePagedChat } from "@/hooks/usePagedChat";
import { useTableRealtime } from "@/hooks/useTableRealtime";
import { getPermissionContext } from "@/utils/permissions";
import { ALLOWED_EXTENSIONS_STRING } from "@/utils/attachments";
import { purchaseRequestService } from "@/services/purchaseRequestService";
import { purchaseRequestKeys } from "./queryKeys";
import { refusal } from "./requestHooks";

function formatWhen(iso) {
  if (!iso) return "";
  return formatDateWith(iso, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }, { time: true });
}

const Message = memo(function Message({ message, highlighted = false }) {
  const isEvent = !!message.metadata?.event;
  return (
    <li
      className={cn("flex gap-2.5 rounded-lg transition-colors duration-700", highlighted && "bg-mauve-3")}
      data-testid="request-message"
      data-message-id={message.id}
      data-highlighted={highlighted || undefined}
    >
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
});

/**
 * Issue #307 — a Purchase Request's own Chat. Self-contained, for the request
 * view (#308) to mount: `request` needs `id`. Members read and post; anyone
 * else who can see the request (purchasing, on an unassigned one) reads only.
 * Mentions pick from the request's members. Every item, member and Buyer
 * change posts here too, so the thread is the request's whole history.
 *
 * Who is notified is the database's call (a trigger on every message): the
 * people mentioned always; otherwise the Buyer and the requesters.
 *
 * Opened from a mention (`focusOnMount`, again each time `openCount` changes),
 * it refetches the thread — the cached one predates the mention — and scrolls
 * to the newest Message that mentions the reader (ADR 0017's Mention Target).
 */
export default function RequestChat({ request, focusOnMount = false, openCount = 0, className = "" }) {
  const requestId = request?.id;
  const { user } = useAuth();
  const { isSuperAdmin } = getPermissionContext(user);
  const queryClient = useQueryClient();
  const attachments = useFileAttachments();
  const { files, isUploading } = attachments;
  const fileInputRef = useRef(null);
  const [text, setText] = useState("");
  const [mentions, setMentions] = useState([]);

  // Every change in any request nudges this channel; refetching one thread is cheap.
  useTableRealtime("purchase_request_messages", {
    invalidateKeys: requestId ? [purchaseRequestKeys.all(requestId)] : [],
    debounceMs: 300,
  });

  const messagesQuery = usePagedChat({
    queryKey: purchaseRequestKeys.messages(requestId),
    fetchPage: ({ before, limit }) => purchaseRequestService.listMessagesPage(requestId, { before, limit }),
    enabled: !!requestId,
  });
  const { data: members = [] } = useQuery({
    queryKey: purchaseRequestKeys.members(requestId),
    queryFn: () => purchaseRequestService.listMembers(requestId),
    enabled: !!requestId,
  });

  const messages = messagesQuery.messages;

  const [highlightId, setHighlightId] = useState(null);
  // Bumped once the deep link's refetch has landed; the Mention Target is looked for then, once.
  const [mentionCheck, setMentionCheck] = useState(0);
  const checkedMention = useRef(0);
  useEffect(() => {
    if (!focusOnMount || !requestId) return undefined;
    let live = true;
    queryClient
      .invalidateQueries({ queryKey: purchaseRequestKeys.messages(requestId) })
      .finally(() => live && setMentionCheck((n) => n + 1));
    return () => {
      live = false;
    };
  }, [focusOnMount, requestId, openCount, queryClient]);
  useEffect(() => {
    if (mentionCheck === checkedMention.current) return;
    checkedMention.current = mentionCheck;
    const target = [...messages].reverse().find((m) => m.metadata?.mentions?.some((p) => p.id === user?.id));
    if (!target) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- marks the Mention Target once the refetch lands
    setHighlightId(target.id);
    document.querySelector(`[data-message-id="${target.id}"]`)?.scrollIntoView?.({ block: "center" });
  }, [mentionCheck, messages, user?.id]);
  const canPost = isSuperAdmin || members.some((m) => m.id === user?.id);
  const people = members.filter((m) => m.id !== user?.id);

  const postMutation = useMutation({
    mutationFn: ({ content, uploaded }) =>
      purchaseRequestService.postMessage(requestId, user?.id, content, { attachments: uploaded, mentions }),
    onSuccess: () => {
      setText("");
      setMentions([]);
      attachments.clear();
    },
    onError: (err) => toast.error(refusal(err)),
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
      toast.error(`Could not upload the file. ${refusal(err)}`);
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

      <ChatScroller
        firstKey={messages[0]?.id}
        lastKey={messages[messages.length - 1]?.id}
        lastIsMine={messages[messages.length - 1]?.author?.id === user?.id}
        hasMore={messagesQuery.hasMore}
        isFetchingMore={messagesQuery.isFetchingMore}
        onLoadMore={messagesQuery.loadMore}
      >
        {messagesQuery.isLoading ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : messagesQuery.isError ? (
          <QueryError title="Couldn't load the chat." onRetry={messagesQuery.refetch} />
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
              <Message key={m.id} message={m} highlighted={m.id === highlightId} />
            ))}
          </ul>
        )}
      </ChatScroller>

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
          <div className="flex w-full min-w-0 max-w-full flex-col rounded-2xl border border-border bg-card p-1.5 ring-mauve-8/20 transition-shadow focus-within:ring-2">
            <MentionTextarea
              rows={2}
              aria-label="Message"
              value={text}
              onChange={setText}
              people={people}
              mentions={mentions}
              onMentionsChange={setMentions}
              onPaste={attachments.addFromPaste}
              onEnterSubmit={handlePost}
              autoFocus={focusOnMount}
              disabled={isPosting}
              placeholder="Message the request — type @ to mention a member"
              className="custom-scrollbar block w-full resize-none border-none bg-transparent px-3 py-2.5 text-sm shadow-none outline-none focus-visible:ring-0 disabled:opacity-50"
            />
            <div className="flex items-center justify-between px-2 pb-0.5 pt-1">
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  title={`Attach files (max ${attachments.max})`}
                  aria-label="Attach files"
                  disabled={isPosting || files.length >= attachments.max}
                  onClick={() => fileInputRef.current?.open()}
                  className="h-auto w-auto text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground disabled:opacity-40"
                >
                  <Paperclip size={15} />
                </Button>
                <EmojiPicker onSelect={(emoji) => setText((prev) => prev + emoji)} disabled={isPosting} />
                <span className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
                  <Clock size={10} /> Enter to send
                </span>
              </div>
              <Button
                type="submit"
                size="sm"
                disabled={(!text.trim() && files.length === 0) || isPosting}
                className="h-8 gap-2 rounded-xl px-4 font-bold"
              >
                {isUploading ? (
                  <><Spinner size="sm" /> Uploading</>
                ) : isPosting ? (
                  "..."
                ) : (
                  <>Send <Send size={14} /></>
                )}
              </Button>
            </div>
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
