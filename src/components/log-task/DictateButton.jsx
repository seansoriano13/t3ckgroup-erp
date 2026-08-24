import { Mic, Square } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import toast from "react-hot-toast"
import { useDictation } from "@/hooks/useDictation"

/**
 * Dictate a Transcript into the DTAR task description. All of the behaviour
 * lives in `useDictation` (ADR 0002); this renders its states and nothing more.
 *
 * On a browser with no recogniser this renders nothing at all — a disabled
 * control the employee can never enable is worse than no control, because it
 * advertises a capability and then blames their browser.
 */

const noticeKeyFor = (employeeId) => `dictation_cloud_notice_${employeeId || "anon"}`

function readNoticeSeen(employeeId) {
  try {
    return window.localStorage.getItem(noticeKeyFor(employeeId)) === "1"
  } catch {
    return false
  }
}

export default function DictateButton({ employeeId, text, phrases, onCommit }) {
  const [noticeSeen, setNoticeSeen] = useState(() => readNoticeSeen(employeeId))
  const noticeSeenRef = useRef(noticeSeen)

  /**
   * Shown only when a Dictation actually runs against the browser vendor's
   * service. On the on-device path it would simply be false.
   */
  const handleCloudNoticeNeeded = useCallback(() => {
    if (noticeSeenRef.current) return
    noticeSeenRef.current = true
    setNoticeSeen(true)
    try {
      window.localStorage.setItem(noticeKeyFor(employeeId), "1")
    } catch {
      // A browser that refuses storage just means the notice shows again.
    }
    toast("Your browser sends dictated audio to its speech service to transcribe it.", {
      icon: "🎙️",
      duration: 6000,
    })
  }, [employeeId])

  const { supported, state, interimText, secondsRemaining, error, start, stop } = useDictation({
    text,
    onCommit,
    phrases,
    cloudNoticeSeen: noticeSeen,
    onCloudNoticeNeeded: handleCloudNoticeNeeded,
  })

  /**
   * The language ladder has run out — en-PH and en-US both refused. Silence
   * here would read as a dead button.
   */
  useEffect(() => {
    if (!error) return
    toast.error(
      error === "language-not-supported"
        ? "Your browser cannot dictate in English right now."
        : "Dictation stopped unexpectedly. Please try again.",
    )
  }, [error])

  if (!supported) return null

  if (state === "blocked") {
    return (
      <span className="mt-1 flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground py-1.5 px-2.5">
        Microphone blocked — enable it in your browser&rsquo;s site settings.
      </span>
    )
  }

  const listening = state === "listening"

  return (
    <div className="flex items-center gap-2 min-w-0">
      <button
        type="button"
        onClick={listening ? stop : start}
        aria-label={listening ? "Stop dictating" : "Dictate description"}
        className={`mt-1 flex items-center gap-1.5 text-[11px] font-bold transition-all py-1.5 px-2.5 rounded-lg hover:bg-muted shrink-0 ${
          listening ? "text-foreground bg-muted" : "text-muted-foreground hover:text-foreground"
        }`}
      >
        {listening ? (
          <>
            <Square size={11} className="fill-current" />
            Stop
            {secondsRemaining !== null && <span className="tabular-nums">{secondsRemaining}s</span>}
          </>
        ) : (
          <>
            <Mic size={12} />
            Dictate
          </>
        )}
      </button>

      {listening && (
        <span className="mt-1 flex items-center gap-1.5 min-w-0 text-[11px] text-muted-foreground">
          <span className="size-1.5 rounded-full bg-red-500 animate-pulse shrink-0" />
          <span className="truncate italic">{interimText || "Listening…"}</span>
        </span>
      )}
    </div>
  )
}
