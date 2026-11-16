import { memo, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Clock, MessagesSquare, Paperclip, Send } from "lucide-react";

import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import Avatar from "@/components/Avatar";
import EmptyState from "@/components/ui/EmptyState";
import EmojiPicker from "@/components/ui/EmojiPicker";
import QueryError from "@/components/ui/QueryError";
import Spinner from "@/components/ui/Spinner";
import { Button } from "@/components/ui/button";
import { FileInput } from "@/components/ui/FileInput";
import BrochureLibraryPicker from "@/components/BrochureLibraryPicker";
import { AttachmentList, AttachmentPreviews } from "@/components/ui/Attachments";
import MentionTextarea, { NoteText } from "@/components/ui/MentionTextarea";
import ChatScroller from "@/components/ui/ChatScroller";
import { useFileAttachments } from "@/hooks/useFileAttachments";
import { usePagedChat } from "@/hooks/usePagedChat";
import { useTableRealtime } from "@/hooks/useTableRealtime";
import { ALLOWED_EXTENSIONS_STRING } from "@/utils/attachments";
import { formatDateWith } from "@/utils/formatDate";
import { ipasChatService } from "@/services/ipasChatService";
import { refusal } from "@/components/purchase-request/requestHooks";
import { ipasChatPeopleKey, ipasMessagesKey } from "./ipasKeys";

function formatWhen(iso) {
  if (!iso) return "";
  return formatDateWith(iso, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }, { time: true });
}

const Message = memo(function Message({ message, highlighted = false }) {
  return (
    <li
      className={cn("flex gap-2.5 rounded-lg transition-colors duration-700", highlighted && "bg-mauve-3")}
      data-testid="ipas-message"
      data-message-id={message.id}
      data-highlighted={highlighted || undefined}
    >
      <Avatar name={message.author?.name || "?"} src={message.author?.avatar_path} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold text-muted-foreground">
          {message.author?.name || "Someone"}
          <span className="font-normal text-muted-foreground/60">
            {" · "}
            {formatWhen(message.created_at)}
          </span>
        </p>
        <NoteText
          content={message.content}
          mentions={message.metadata?.mentions}
          className="text-sm break-words text-foreground"
        />
        <AttachmentList attachments={message.metadata?.attachments} className={message.content ? "mt-2" : "mt-1"} />
      </div>
    </li>
  );
});

/**
 * The IPAS's own Chat. Everyone who can open the IPAS reads and posts here, and can
 * mention anyone else who can open it. Who is notified is the database's call: the
 * people mentioned; otherwise whoever raised the IPAS and everyone who posted before.
 *
 * `focusOnMount` (a chat notification opened the IPAS) refetches the thread and marks
 * the newest message that mentions the reader.
 */
export default function IpasChat({ ipasId, focusOnMount = false, className = "" }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const attachments = useFileAttachments();
  const { files, isUploading } = attachments;
  const fileInputRef = useRef(null);
  const [text, setText] = useState("");
  const [mentions, setMentions] = useState([]);

  useTableRealtime("ipas_messages", {
    invalidateKeys: ipasId ? [ipasMessagesKey(ipasId)] : [],
    debounceMs: 300,
  });

  const messagesQuery = usePagedChat({
    queryKey: ipasMessagesKey(ipasId),
    fetchPage: ({ before, limit }) => ipasChatService.listMessagesPage(ipasId, { before, limit }),
    enabled: !!ipasId,
  });
  const { data: everyone = [] } = useQuery({
    queryKey: ipasChatPeopleKey,
    queryFn: () => ipasChatService.listPeople(),
    staleTime: 5 * 60 * 1000,
  });
  const messages = messagesQuery.messages;
  const people = everyone.filter((p) => p.id !== user?.id);

  const [highlightId, setHighlightId] = useState(null);
  const [mentionCheck, setMentionCheck] = useState(0);
  const checkedMention = useRef(0);
  const sectionRef = useRef(null);
  useEffect(() => {
    if (focusOnMount) sectionRef.current?.scrollIntoView?.({ block: "start" });
  }, [focusOnMount]);
  useEffect(() => {
    if (!focusOnMount || !ipasId) return undefined;
    let live = true;
    queryClient
      .invalidateQueries({ queryKey: ipasMessagesKey(ipasId) })
      .finally(() => live && setMentionCheck((n) => n + 1));
    return () => {
      live = false;
    };
  }, [focusOnMount, ipasId, queryClient]);
  useEffect(() => {
    if (mentionCheck === checkedMention.current) return;
    checkedMention.current = mentionCheck;
    const target = [...messages].reverse().find((m) => m.metadata?.mentions?.some((p) => p.id === user?.id));
    if (!target) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- marks the mentioned message once the refetch lands
    setHighlightId(target.id);
    document.querySelector(`[data-message-id="${target.id}"]`)?.scrollIntoView?.({ block: "center" });
  }, [mentionCheck, messages, user?.id]);

  const postMutation = useMutation({
    mutationFn: ({ content, uploaded }) =>
      ipasChatService.postMessage(ipasId, user?.id, content, { attachments: uploaded, mentions }),
    onSuccess: () => {
      setText("");
      setMentions([]);
      attachments.clear();
    },
    onError: (err) => toast.error(refusal(err)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ipasMessagesKey(ipasId) }),
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
    <section
      ref={sectionRef}
      id="ipas-chat"
      data-testid="ipas-chat"
      aria-label="IPAS chat"
      className={cn("flex h-[32rem] min-h-0 flex-col rounded-xl border border-border bg-card", className)}
    >
      <div className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
        <MessagesSquare size={14} className="text-muted-foreground" />
        <h3 className="text-sm font-semibold text-foreground">Chat</h3>
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
            description="Talk about this IPAS here. Type @ to mention someone."
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

      <form
        className="shrink-0 border-t border-border/50 px-4 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          handlePost();
        }}
      >
        <FileInput ref={fileInputRef} multiple accept={ALLOWED_EXTENSIONS_STRING} onFiles={attachments.addFiles} />
        <BrochureLibraryPicker compact disabled={isPosting} onPick={attachments.addLinked} />
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
            placeholder="Message about this IPAS — type @ to mention someone"
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
                <>
                  <Spinner size="sm" /> Uploading
                </>
              ) : isPosting ? (
                "..."
              ) : (
                <>
                  Send <Send size={14} />
                </>
              )}
            </Button>
          </div>
        </div>
      </form>
    </section>
  );
}
