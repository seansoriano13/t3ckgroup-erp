import { useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import toast from "react-hot-toast"
import { useAuth } from "@/context/AuthContext"
import { opportunityService } from "@/services/opportunityService"
import { usePagedChat } from "@/hooks/usePagedChat"
import { useFileAttachments } from "@/hooks/useFileAttachments"
import SorChatColumn from "@/components/sor/modal/SorChatColumn"

// The viewer may read an SOR at these levels (ADR 0021); "locked" and "none"
// see no SOR chat.
const READABLE_LEVELS = ["full", "participant"]

/**
 * #753: the SOR's own chat, shown beside a Group Task's chat in the split
 * view. Posting writes to the SOR's notes through the same service call the
 * SOR window uses, so the SOR's rules apply. Renders nothing for viewers who
 * can't read the SOR.
 */
export default function SorChatPane({ opportunityId, isOpen, employees = [] }) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const attachments = useFileAttachments()
  const fileInputRef = useRef(null)
  const [note, setNote] = useState("")
  const [noteMentions, setNoteMentions] = useState([])

  const { data: accessLevel } = useQuery({
    queryKey: ["sorAccessLevel", opportunityId],
    queryFn: () => opportunityService.getAccessLevel(opportunityId),
    enabled: !!opportunityId && isOpen,
  })
  const canRead = READABLE_LEVELS.includes(accessLevel)

  const notesChat = usePagedChat({
    queryKey: ["opportunityNotes", opportunityId, "chat"],
    fetchPage: ({ before, limit }) =>
      opportunityService.getNotesPage(opportunityId, { before, limit }),
    enabled: !!opportunityId && isOpen && canRead,
  })

  const addNote = useMutation({
    mutationFn: ({ content, attachments: uploaded, mentions }) =>
      opportunityService.addNote(opportunityId, user?.id, content, uploaded, mentions),
    onSuccess: () => {
      setNote("")
      setNoteMentions([])
      attachments.clear()
      queryClient.invalidateQueries({ queryKey: ["opportunityNotes", opportunityId] })
    },
    onError: (err) => toast.error(err.message),
  })

  if (!opportunityId || !canRead) return null

  const handlePostNote = async () => {
    const content = note.trim()
    if (!content && attachments.files.length === 0) return
    if (attachments.isUploading || addNote.isPending) return
    let uploaded = []
    try {
      uploaded = await attachments.upload()
    } catch (err) {
      toast.error(`Upload failed: ${err.message}`)
      return
    }
    addNote.mutate({ content, attachments: uploaded, mentions: noteMentions })
  }

  return (
    <div
      className="w-[380px] shrink-0 flex flex-col bg-card border-l border-border"
      data-testid="sor-chat-pane"
    >
      <SorChatColumn
        notes={notesChat.messages}
        loadingNotes={notesChat.isLoading}
        currentUserId={user?.id}
        hasMoreNotes={notesChat.hasMore}
        isFetchingMoreNotes={notesChat.isFetchingMore}
        onLoadMoreNotes={notesChat.loadMore}
        handleMentionClick={() => {}}
        note={note}
        setNote={setNote}
        noteMentions={noteMentions}
        setNoteMentions={setNoteMentions}
        employees={employees}
        attachments={attachments}
        fileInputRef={fileInputRef}
        isPosting={addNote.isPending}
        handlePostNote={handlePostNote}
      />
    </div>
  )
}
