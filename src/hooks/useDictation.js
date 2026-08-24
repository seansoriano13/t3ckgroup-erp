import { useCallback, useEffect, useMemo, useRef, useState } from "react"

/**
 * Dictation for the DTAR task description. See ADR 0002 for why this is the
 * browser's own recogniser rather than the Gemini client in `aiService`.
 *
 * The hook owns every decision in the feature — including the append itself —
 * so the rule most likely to break in practice ("append, never replace") is
 * the rule under test rather than untested wiring in a component.
 */

/**
 * Chrome exposes the unprefixed constructor only from version 139; it has
 * carried the webkit-prefixed one since 33, and Safari has never exposed
 * anything else. Checking one spelling alone misses real users.
 *
 * Firefox 142 does implement this, but behind `media.webspeech.recognition.enable`,
 * off by default — implemented and switched off, not absent. Do not "fix" this
 * by special-casing Firefox.
 */
function getRecognitionCtor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null
}

/** Philippine English: local place and client names degrade badly under en-US. */
const DEFAULT_LANG = "en-PH"

/** Not every engine offers en-PH, and a Dictation is better than none. */
const FALLBACK_LANG = "en-US"

/**
 * Long enough for a site-visit debrief, short enough that a phone left
 * recording in a pocket is harmless. The API enforces no duration of its own.
 */
const MAX_SECONDS = 60

/** A silent cutoff reads as a crash, so the last stretch is announced. */
const COUNTDOWN_FROM = 10

/** Biasing across hundreds of phrases degrades accuracy rather than helping. */
const MAX_PHRASES = 50
const PHRASE_BOOST = 3

const DENIED = ["not-allowed", "service-not-allowed"]

/**
 * How long to wait on the on-device availability check before giving up and
 * using the vendor service. The whole launch hangs behind this promise, so a
 * check that never settles would leave the control doing nothing, silently.
 */
const AVAILABILITY_TIMEOUT_MS = 1500

/**
 * Append, never replace. The employee may have typed before dictating, and may
 * keep typing while the Dictation runs — so the text is read at commit time,
 * not at start time.
 */
function appendTranscript(text, transcript) {
  const existing = text || ""
  if (!existing) return transcript
  return /\s$/.test(existing) ? existing + transcript : `${existing} ${transcript}`
}

/**
 * Prime the recogniser with the project and campaign names the employee
 * actually uses — the proper nouns a generic model mangles. A hint, not a
 * restriction: anything can still be dictated. Skipped silently where the
 * browser has no phrase constructor, since this is a pure enhancement and must
 * never block a Dictation.
 */
function buildPhrases(phrases) {
  const Phrase = window.SpeechRecognitionPhrase
  if (typeof Phrase !== "function" || !Array.isArray(phrases)) return null
  const usable = phrases
    .map((phrase) => (typeof phrase === "string" ? phrase.trim() : ""))
    .filter(Boolean)
    .slice(0, MAX_PHRASES)
  if (!usable.length) return null
  try {
    return usable.map((phrase) => new Phrase(phrase, PHRASE_BOOST))
  } catch {
    return null
  }
}

/**
 * Ask whether this language can be recognised on the device. A pack that is
 * merely downloadable is fetched in the background and *this* Dictation goes
 * to the vendor service — making the employee wait on a download mid-task
 * would be a worse feature than sending one recording off-device.
 *
 * Asked once when the hook mounts, never on the press itself — see `start`.
 */
function decideProcessLocally(Ctor, lang, timeoutMs) {
  if (typeof Ctor.available !== "function") return Promise.resolve(false)
  const query = { langs: [lang], processLocally: true }
  const asked = Promise.resolve()
    .then(() => Ctor.available(query))
    .then((availability) => {
      if (availability === "available") return true
      if (availability === "downloadable") {
        Promise.resolve(Ctor.install?.(query)).catch(() => {})
      }
      return false
    })
    .catch(() => false)
  const gaveUp = new Promise((resolve) => {
    setTimeout(() => resolve(false), timeoutMs)
  })
  return Promise.race([asked, gaveUp])
}

/**
 * The ladder a rejected language walks down: on-device en-PH, then the vendor
 * service in en-PH, then the vendor service in en-US, then give up and say so.
 * Returns null when there is nowhere left to go.
 */
function nextAttempt({ processLocally, lang }) {
  if (processLocally) return { processLocally: false, lang }
  if (lang !== FALLBACK_LANG) return { processLocally: false, lang: FALLBACK_LANG }
  return null
}

export function useDictation({
  text = "",
  onCommit,
  lang = DEFAULT_LANG,
  phrases,
  cloudNoticeSeen = false,
  onCloudNoticeNeeded,
  availabilityTimeoutMs = AVAILABILITY_TIMEOUT_MS,
} = {}) {
  const Ctor = useMemo(() => getRecognitionCtor(), [])

  const [state, setState] = useState("idle")
  const [interimText, setInterimText] = useState("")
  const [secondsRemaining, setSecondsRemaining] = useState(null)
  const [processingLocally, setProcessingLocally] = useState(null)
  const [error, setError] = useState(null)

  const recognitionRef = useRef(null)
  const bufferRef = useRef("")
  const errorRef = useRef(null)
  const tickRef = useRef(null)
  const blockedRef = useRef(false)
  const unmountedRef = useRef(false)
  // Answered on mount so the press never has to wait for it.
  const localReadyRef = useRef(false)
  // The language ladder re-enters `launch` from inside its own closure.
  const launchRef = useRef(null)

  // Read at commit time so text typed during the Dictation is not clobbered.
  const propsRef = useRef({ text, onCommit, cloudNoticeSeen, onCloudNoticeNeeded, phrases })
  useEffect(() => {
    propsRef.current = { text, onCommit, cloudNoticeSeen, onCloudNoticeNeeded, phrases }
  })

  const clearTick = useCallback(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current)
      tickRef.current = null
    }
  }, [])

  const launch = useCallback(
    (attempt) => {
      if (unmountedRef.current || !Ctor) return

      const recognition = new Ctor()
      recognition.lang = attempt.lang
      // A thinking pause must not end the Dictation.
      recognition.continuous = true
      // Interim results drive the "listening" indicator only. They are never
      // written into the description.
      recognition.interimResults = true
      recognition.processLocally = attempt.processLocally

      try {
        const hints = buildPhrases(propsRef.current.phrases)
        if (hints) recognition.phrases = hints
      } catch {
        // Biasing is an enhancement. Losing it is not losing the Dictation.
      }

      /**
       * The disclosure waits for audio to actually flow. Raising it at
       * construction would spend the one-time notice on a Dictation the
       * employee then denied at the permission prompt — telling them their
       * audio reached the vendor when none of it did.
       */
      recognition.onstart = () => {
        if (attempt.processLocally || propsRef.current.cloudNoticeSeen) return
        propsRef.current.onCloudNoticeNeeded?.()
      }

      recognition.onresult = (event) => {
        let interim = ""
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const result = event.results[i]
          const transcript = result[0]?.transcript ?? ""
          if (result.isFinal) {
            const segment = transcript.trim()
            if (!segment) continue
            bufferRef.current = bufferRef.current ? `${bufferRef.current} ${segment}` : segment
          } else {
            interim += transcript
          }
        }
        setInterimText(interim.trim())
      }

      recognition.onerror = (event) => {
        errorRef.current = event?.error ?? "unknown"
        if (DENIED.includes(errorRef.current)) blockedRef.current = true
      }

      /**
       * Every way a Dictation can end arrives here: the employee tapping stop,
       * the cap firing, and Safari self-terminating on silence despite
       * `continuous`. All three commit — treating the last as anything other
       * than a normal stop silently throws away what was said.
       */
      recognition.onend = () => {
        const transcript = bufferRef.current.trim()
        const failure = errorRef.current
        recognitionRef.current = null
        clearTick()
        setInterimText("")
        setSecondsRemaining(null)

        // The engine refused this language. Walk down the ladder rather than
        // failing in the employee's face.
        if (failure === "language-not-supported") {
          const next = nextAttempt(attempt)
          if (next) {
            errorRef.current = null
            launchRef.current?.(next)
            return
          }
        }

        bufferRef.current = ""
        setProcessingLocally(null)
        setState(blockedRef.current ? "blocked" : "idle")
        // `no-speech` is not a failure worth reporting — it just means the
        // description is left exactly as it was.
        if (failure && failure !== "no-speech" && !blockedRef.current) setError(failure)
        if (!blockedRef.current && transcript) {
          propsRef.current.onCommit?.(appendTranscript(propsRef.current.text, transcript))
        }
      }

      recognitionRef.current = recognition
      bufferRef.current = ""
      errorRef.current = null
      setInterimText("")
      setSecondsRemaining(null)
      setProcessingLocally(attempt.processLocally)
      setState("listening")

      let elapsed = 0
      clearTick()
      tickRef.current = setInterval(() => {
        elapsed += 1
        if (elapsed >= MAX_SECONDS) {
          // Cleared first: a slow `onend` would otherwise re-issue stop every second.
          clearTick()
          recognitionRef.current?.stop()
          return
        }
        const left = MAX_SECONDS - elapsed
        setSecondsRemaining(left <= COUNTDOWN_FROM ? left : null)
      }, 1000)

      /**
       * `start()` throws on a stale recogniser, an insecure origin, or a
       * browser that exposes the constructor without a working engine. Left
       * unhandled the control simply does nothing, which is indistinguishable
       * from a dead button — so the failure is surfaced and the control reset.
       */
      try {
        recognition.start()
      } catch {
        clearTick()
        recognitionRef.current = null
        setInterimText("")
        setSecondsRemaining(null)
        setProcessingLocally(null)
        setState("idle")
        setError("start-failed")
      }
    },
    [Ctor, clearTick],
  )

  useEffect(() => {
    launchRef.current = launch
  }, [launch])

  /**
   * Negotiated once, on mount. Availability does not change between presses,
   * and asking on the press would put an `await` between the click and
   * `recognition.start()`.
   */
  useEffect(() => {
    if (!Ctor) return undefined
    let cancelled = false
    decideProcessLocally(Ctor, lang, availabilityTimeoutMs).then((local) => {
      if (!cancelled) localReadyRef.current = local
    })
    return () => {
      cancelled = true
    }
  }, [Ctor, availabilityTimeoutMs, lang])

  /**
   * Synchronous, deliberately. Chrome drops user activation across an `await`
   * and then declines to open the microphone prompt without raising anything —
   * the control simply does nothing. `recognition.start()` must happen inside
   * the press that asked for it. A press that beats the availability answer
   * uses the vendor service rather than waiting for it.
   */
  const start = useCallback(() => {
    // The browser will not re-prompt after a denial, so neither do we.
    if (!Ctor || blockedRef.current || recognitionRef.current) return
    setError(null)
    launch({ processLocally: localReadyRef.current, lang })
  }, [Ctor, lang, launch])

  const stop = useCallback(() => {
    recognitionRef.current?.stop()
  }, [])

  /**
   * Closing the log form is not saving. `abort` rather than `stop`, because
   * `stop` emits a final result into a component that is unmounting — and the
   * handlers are detached first so an in-flight end cannot commit either.
   */
  useEffect(() => {
    // StrictMode runs this effect mount -> cleanup -> mount in development.
    // Without this line the cleanup's flag stays latched into the surviving
    // mount and every later Dictation returns before constructing anything.
    unmountedRef.current = false
    return () => {
      unmountedRef.current = true
      clearTick()
      const recognition = recognitionRef.current
      if (!recognition) return
      recognition.onstart = null
      recognition.onresult = null
      recognition.onerror = null
      recognition.onend = null
      recognitionRef.current = null
      recognition.abort()
    }
  }, [clearTick])

  return {
    supported: Boolean(Ctor),
    state,
    interimText,
    secondsRemaining,
    processingLocally,
    error,
    start,
    stop,
  }
}
