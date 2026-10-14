import { useEffect, useRef, useState } from "react"
import { Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import MentionTextarea from "../ui/MentionTextarea"
import BeforeAfter from "./BeforeAfter"
import SampleProvider from "./SampleProvider"
import { PEOPLE } from "./sampleData"

/**
 * The Chat window's message box, before and after the @mention list stopped
 * being cut off (ADR 0030). Both panes are the app's real MentionTextarea in
 * the same box the Chat window draws; only the box differs. Before, the box
 * and the form around it clipped anything sticking out, and the list opens
 * upward out of the box, so it was drawn and then hidden.
 */

const PEOPLE_LIST = Object.values(PEOPLE).map((p) => ({ id: p.id, name: p.name, subDepartment: p.sub_department }))

function Message({ mine, name, children }) {
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className="max-w-[80%] space-y-1">
        <p className={`px-1 text-label font-bold uppercase tracking-tight text-muted-foreground ${mine ? "text-right" : ""}`}>{name}</p>
        <p className={`rounded-2xl px-4 py-2.5 text-sm ${mine ? "rounded-tr-none bg-mauve-12 text-mauve-1" : "rounded-tl-none border border-border bg-card"}`}>{children}</p>
      </div>
    </div>
  )
}

function ChatBox({ clip }) {
  const [text, setText] = useState("")
  const [mentions, setMentions] = useState([])
  const root = useRef(null)

  // Open with the list already showing, as if "@" had just been typed. The
  // list only opens from a typing event, so replay one.
  useEffect(() => {
    const area = root.current?.querySelector("textarea")
    if (!area) return
    const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set
    set.call(area, "@")
    area.setSelectionRange(1, 1)
    area.dispatchEvent(new Event("input", { bubbles: true }))
  }, [])

  const hide = clip ? " overflow-hidden" : ""
  return (
    <div ref={root} className="flex h-[400px] flex-col bg-card">
      <div className="flex-1 space-y-3 overflow-hidden p-4">
        <Message name="Lara Mendoza">Site visit is confirmed for Friday.</Message>
        <Message mine name="You">Great. I will loop in the team.</Message>
      </div>
      <form className={`flex w-full min-w-0 max-w-full flex-col border-t border-border bg-muted/10 p-4${hide}`} onSubmit={(e) => e.preventDefault()}>
        <div className={`flex w-full min-w-0 max-w-full flex-col rounded-2xl border border-border bg-card p-1.5${hide}`}>
          <MentionTextarea
            value={text}
            onChange={setText}
            people={PEOPLE_LIST}
            mentions={mentions}
            onMentionsChange={setMentions}
            placeholder="Write a message or paste a file..."
            rows={1}
            className="block w-full resize-none border-none bg-transparent px-3 py-2.5 text-sm shadow-none outline-none focus-visible:ring-0"
          />
          <div className="flex items-center justify-end px-2 pt-1 pb-0.5">
            <Button type="submit" size="sm" className="h-8 gap-2 rounded-xl px-4 font-bold">
              Send <Send size={14} />
            </Button>
          </div>
        </div>
      </form>
    </div>
  )
}

export function ChatMentionSample() {
  return (
    <SampleProvider>
      <BeforeAfter
        beforeNote="Typing @ shows nothing"
        afterNote="The list of people shows"
        before={<ChatBox clip />}
        after={<ChatBox />}
      />
    </SampleProvider>
  )
}
