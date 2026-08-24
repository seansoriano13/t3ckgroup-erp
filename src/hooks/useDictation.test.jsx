import { act, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useDictation } from "./useDictation"

/**
 * Dictation for the DTAR task description (ADR 0002). The hook owns every
 * decision in the feature — including the append itself — so that the rule
 * most likely to break in practice ("append, never replace") is the rule
 * under test rather than untested wiring in a component.
 *
 * jsdom implements no speech recognition API, so a stub constructor stands in
 * for it. `src/test/setup.js` does the same for WebSocket, and the Vitest
 * config restores stubbed globals between tests.
 */

/** The last recogniser the hook constructed, so a test can drive it. */
let live = null

class StubRecognition {
  constructor() {
    this.lang = null
    this.continuous = false
    this.interimResults = false
    this.phrases = []
    this.started = 0
    this.stopped = 0
    this.aborted = 0
    live = this
  }
  start() {
    this.started += 1
  }
  stop() {
    this.stopped += 1
  }
  abort() {
    this.aborted += 1
  }

  /** Deliver a batch of segments as the browser would. */
  emit(segments) {
    const results = segments.map(([transcript, isFinal]) => {
      const alternatives = [{ transcript }]
      return Object.assign(alternatives, { isFinal, length: 1 })
    })
    this.onresult?.({ resultIndex: 0, results: Object.assign(results, { length: results.length }) })
  }
  /** Permission granted and audio actually flowing. */
  begin() {
    this.onstart?.()
  }
  fail(error) {
    this.onerror?.({ error })
  }
  end() {
    this.onend?.()
  }
}

const install = (Ctor = StubRecognition, { prefixed = false } = {}) => {
  live = null
  vi.stubGlobal("SpeechRecognition", prefixed ? undefined : Ctor)
  vi.stubGlobal("webkitSpeechRecognition", prefixed ? Ctor : undefined)
}

const uninstall = () => {
  live = null
  vi.stubGlobal("SpeechRecognition", undefined)
  vi.stubGlobal("webkitSpeechRecognition", undefined)
}

/** Let a real (very short) availability timeout elapse. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 25))

const dictate = (options = {}) => {
  const onCommit = vi.fn()
  const utils = renderHook((props) => useDictation(props), {
    initialProps: { text: "", onCommit, ...options },
  })
  return { ...utils, onCommit }
}

describe("useDictation", () => {
  describe("whether the browser can dictate at all", () => {
    it("reports unsupported when the browser has no recogniser", () => {
      uninstall()

      const { result } = dictate()

      expect(result.current.supported).toBe(false)
    })

    it("reports supported when the browser has the unprefixed recogniser", () => {
      install()

      const { result } = dictate()

      expect(result.current.supported).toBe(true)
    })

    it("reports supported when the browser only has the webkit-prefixed recogniser", () => {
      install(StubRecognition, { prefixed: true })

      const { result } = dictate()

      expect(result.current.supported).toBe(true)
    })
  })

  describe("speaking a Transcript into the description", () => {
    it("listens in Philippine English, and keeps listening through a pause", () => {
      install()
      const { result } = dictate()

      act(() => result.current.start())

      expect(live.lang).toBe("en-PH")
      expect(live.continuous).toBe(true)
      expect(live.interimResults).toBe(true)
      expect(live.started).toBe(1)
      expect(result.current.state).toBe("listening")
    })

    it("commits nothing until the Dictation is stopped", () => {
      install()
      const { result, onCommit } = dictate({ text: "Existing note." })

      act(() => result.current.start())
      act(() => live.emit([["Replaced the office switch.", true]]))

      expect(onCommit).not.toHaveBeenCalled()
    })

    it("appends the Transcript to the text already in the description", () => {
      install()
      const { result, onCommit } = dictate({ text: "Existing note." })

      act(() => result.current.start())
      act(() => live.emit([["Replaced the office switch.", true]]))
      act(() => result.current.stop())
      act(() => live.end())

      expect(onCommit).toHaveBeenCalledWith("Existing note. Replaced the office switch.")
    })

    it("does not lead with a separator when the description is empty", () => {
      install()
      const { result, onCommit } = dictate({ text: "" })

      act(() => result.current.start())
      act(() => live.emit([["Replaced the office switch.", true]]))
      act(() => result.current.stop())
      act(() => live.end())

      expect(onCommit).toHaveBeenCalledWith("Replaced the office switch.")
    })

    it("keeps only the final segments, never the interim guesses", () => {
      install()
      const { result, onCommit } = dictate()

      act(() => result.current.start())
      act(() => live.emit([["Replaced the", false]]))
      act(() => live.emit([["Replaced the office switch.", true]]))
      act(() => live.emit([["Waiting on", false]]))
      act(() => result.current.stop())
      act(() => live.end())

      expect(onCommit).toHaveBeenCalledWith("Replaced the office switch.")
    })

    it("surfaces the interim guess while listening, so the control can show it", () => {
      install()
      const { result } = dictate()

      act(() => result.current.start())
      act(() => live.emit([["Replaced the", false]]))

      expect(result.current.interimText).toBe("Replaced the")
    })

    it("joins several final segments into one Transcript", () => {
      install()
      const { result, onCommit } = dictate()

      act(() => result.current.start())
      act(() => live.emit([["Replaced the office switch.", true]]))
      act(() => live.emit([["Waiting on the supplier quote.", true]]))
      act(() => result.current.stop())
      act(() => live.end())

      expect(onCommit).toHaveBeenCalledWith(
        "Replaced the office switch. Waiting on the supplier quote.",
      )
    })

    it("returns to idle once the Dictation has been committed", () => {
      install()
      const { result } = dictate()

      act(() => result.current.start())
      act(() => live.emit([["Replaced the office switch.", true]]))
      act(() => result.current.stop())
      act(() => live.end())

      expect(result.current.state).toBe("idle")
      expect(result.current.interimText).toBe("")
    })
  })

  describe("every other way a Dictation ends", () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    it("commits what it heard when the sixty second cap is reached", () => {
      vi.useFakeTimers()
      install()
      const { result, onCommit } = dictate()

      act(() => result.current.start())
      act(() => live.emit([["Replaced the office switch.", true]]))
      act(() => vi.advanceTimersByTime(60_000))
      act(() => live.end())

      expect(live.stopped).toBe(1)
      expect(onCommit).toHaveBeenCalledWith("Replaced the office switch.")
    })

    /** A cap that keeps firing re-issues stop every second if onend is slow. */
    it("stops asking once the cap has fired", () => {
      vi.useFakeTimers()
      install()
      const { result } = dictate()

      act(() => result.current.start())
      act(() => vi.advanceTimersByTime(65_000))

      expect(live.stopped).toBe(1)
    })

    it("says nothing about the cap until ten seconds remain", () => {
      vi.useFakeTimers()
      install()
      const { result } = dictate()

      act(() => result.current.start())
      act(() => vi.advanceTimersByTime(49_000))

      expect(result.current.secondsRemaining).toBeNull()
    })

    it("counts down over the last ten seconds", () => {
      vi.useFakeTimers()
      install()
      const { result } = dictate()

      act(() => result.current.start())
      act(() => vi.advanceTimersByTime(51_000))

      expect(result.current.secondsRemaining).toBe(9)
    })

    /**
     * Safari self-terminates on silence despite `continuous`. Treating that as
     * anything other than a normal stop silently throws away what was said.
     */
    it("commits the buffer when the browser ends the Dictation on its own", () => {
      install()
      const { result, onCommit } = dictate()

      act(() => result.current.start())
      act(() => live.emit([["Replaced the office switch.", true]]))
      act(() => live.end())

      expect(onCommit).toHaveBeenCalledWith("Replaced the office switch.")
      expect(result.current.state).toBe("idle")
    })

    /**
     * Closing the log form is not saving. `abort` rather than `stop`, because
     * `stop` emits a final result into a component that is unmounting.
     */
    it("discards the Dictation when the form is closed mid-sentence", () => {
      install()
      const { result, onCommit, unmount } = dictate()

      act(() => result.current.start())
      act(() => live.emit([["Replaced the office switch.", true]]))
      unmount()

      expect(live.aborted).toBe(1)
      expect(live.stopped).toBe(0)
      expect(onCommit).not.toHaveBeenCalled()
    })

    it("leaves the description untouched when it heard no speech", () => {
      install()
      const { result, onCommit } = dictate({ text: "Existing note." })

      act(() => result.current.start())
      act(() => live.fail("no-speech"))
      act(() => live.end())

      expect(onCommit).not.toHaveBeenCalled()
      expect(result.current.state).toBe("idle")
    })

    it("reports a blocked microphone rather than failing silently", () => {
      install()
      const { result, onCommit } = dictate()

      act(() => result.current.start())
      act(() => live.fail("not-allowed"))
      act(() => live.end())

      expect(result.current.state).toBe("blocked")
      expect(onCommit).not.toHaveBeenCalled()
    })

    /** The browser will not re-prompt after a denial, so neither do we. */
    it("does not try again once the microphone is blocked", () => {
      install()
      const { result } = dictate()

      act(() => result.current.start())
      act(() => live.fail("not-allowed"))
      act(() => live.end())
      const attempts = live.started
      act(() => result.current.start())

      expect(live.started).toBe(attempts)
      expect(result.current.state).toBe("blocked")
    })
  })

  /**
   * On-device recognition keeps the audio on the machine. The disclosure that
   * audio is leaving the device is shown only when that is actually true —
   * on the local path it would be a lie.
   */
  describe("keeping the audio on the device where it can", () => {
    const withPack = (availability) => {
      class PackAware extends StubRecognition {}
      PackAware.available = vi.fn().mockResolvedValue(availability)
      PackAware.install = vi.fn().mockResolvedValue(true)
      install(PackAware)
      return PackAware
    }

    /** Let the on-mount availability check land, then press. */
    const startAndSettle = async (result) => {
      await act(async () => {
        await settle()
      })
      act(() => result.current.start())
      act(() => live.begin())
    }

    it("recognises locally when the language pack is already installed", async () => {
      const Ctor = withPack("available")
      const onCloudNoticeNeeded = vi.fn()
      const { result } = dictate({ onCloudNoticeNeeded })

      await startAndSettle(result)

      expect(Ctor.available).toHaveBeenCalledWith(
        expect.objectContaining({ langs: ["en-PH"], processLocally: true }),
      )
      expect(live.processLocally).toBe(true)
      expect(onCloudNoticeNeeded).not.toHaveBeenCalled()
    })

    it("does not make the employee wait on a language pack download", async () => {
      const Ctor = withPack("downloadable")
      const onCloudNoticeNeeded = vi.fn()
      const { result } = dictate({ onCloudNoticeNeeded })

      await startAndSettle(result)

      expect(Ctor.install).toHaveBeenCalled()
      expect(live.processLocally).toBe(false)
      expect(live.started).toBe(1)
      expect(onCloudNoticeNeeded).toHaveBeenCalled()
    })

    it("falls back to the vendor service when no pack can be had", async () => {
      withPack("unavailable")
      const onCloudNoticeNeeded = vi.fn()
      const { result } = dictate({ onCloudNoticeNeeded })

      await startAndSettle(result)

      expect(live.processLocally).toBe(false)
      expect(onCloudNoticeNeeded).toHaveBeenCalled()
    })

    it("falls back to the vendor service when the browser cannot check at all", async () => {
      install()
      const onCloudNoticeNeeded = vi.fn()
      const { result } = dictate({ onCloudNoticeNeeded })

      await startAndSettle(result)

      expect(live.started).toBe(1)
      expect(onCloudNoticeNeeded).toHaveBeenCalled()
    })

    it("stays quiet about the vendor service once the employee has been told", async () => {
      withPack("unavailable")
      const onCloudNoticeNeeded = vi.fn()
      const { result } = dictate({ onCloudNoticeNeeded, cloudNoticeSeen: true })

      await startAndSettle(result)

      expect(onCloudNoticeNeeded).not.toHaveBeenCalled()
      expect(live.started).toBe(1)
    })

    it("exposes whether it is recognising on the device", async () => {
      withPack("available")
      const { result } = dictate()

      await startAndSettle(result)

      expect(result.current.processingLocally).toBe(true)
    })

    it("holds the notice back until the microphone is actually live", async () => {
      withPack("unavailable")
      const onCloudNoticeNeeded = vi.fn()
      const { result } = dictate({ onCloudNoticeNeeded })

      await act(async () => {
        await settle()
      })
      act(() => result.current.start())

      expect(onCloudNoticeNeeded).not.toHaveBeenCalled()
    })

    /** A denial that never reached the vendor must not burn the one-time notice. */
    it("does not spend the notice on a Dictation the employee never granted", async () => {
      withPack("unavailable")
      const onCloudNoticeNeeded = vi.fn()
      const { result } = dictate({ onCloudNoticeNeeded })

      await act(async () => {
        await settle()
      })
      act(() => result.current.start())
      act(() => live.fail("not-allowed"))
      act(() => live.end())

      expect(onCloudNoticeNeeded).not.toHaveBeenCalled()
    })

    /**
     * Chrome drops user activation across an await, and then declines to open
     * the microphone prompt without raising anything. The recogniser must be
     * constructed and started inside the press itself, never a tick later.
     */
    it("starts inside the press, without awaiting the availability check", async () => {
      withPack("available")
      const { result } = dictate()
      await act(async () => {
        await settle()
      })

      act(() => result.current.start())

      expect(live).not.toBeNull()
      expect(live.started).toBe(1)
    })

    it("uses the vendor service when pressed before the check has answered", () => {
      class Hanging extends StubRecognition {}
      Hanging.available = vi.fn(() => new Promise(() => {}))
      install(Hanging)
      const { result } = dictate()

      act(() => result.current.start())

      expect(live).not.toBeNull()
      expect(live.started).toBe(1)
      expect(live.processLocally).toBe(false)
    })

    it("retries against the vendor service when the local pack turns out unusable", async () => {
      withPack("available")
      const { result } = dictate()

      await startAndSettle(result)
      const local = live
      await act(async () => {
        local.fail("language-not-supported")
        local.end()
      })

      expect(live).not.toBe(local)
      expect(live.processLocally).toBe(false)
      expect(live.started).toBe(1)
    })
  })

  describe("when the recogniser refuses to start", () => {
    it("says so rather than doing nothing at all", () => {
      class Refusing extends StubRecognition {
        start() {
          throw new Error("InvalidStateError")
        }
      }
      install(Refusing)
      const { result } = dictate()

      act(() => result.current.start())

      expect(result.current.error).toBe("start-failed")
      expect(result.current.state).toBe("idle")
    })

    it("can be pressed again after a refusal", () => {
      let refuse = true
      class Flaky extends StubRecognition {
        start() {
          if (refuse) throw new Error("InvalidStateError")
          super.start()
        }
      }
      install(Flaky)
      const { result } = dictate()

      act(() => result.current.start())
      refuse = false
      act(() => result.current.start())

      expect(result.current.state).toBe("listening")
    })
  })

  describe("when Philippine English is not on offer", () => {
    const rejectingPH = () => {
      install()
      return null
    }

    it("falls back to US English when the vendor service rejects en-PH", () => {
      rejectingPH()
      const { result } = dictate()

      act(() => result.current.start())
      expect(live.lang).toBe("en-PH")
      act(() => live.fail("language-not-supported"))
      act(() => live.end())

      expect(live.lang).toBe("en-US")
      expect(live.started).toBe(1)
    })

    it("gives up loudly when even US English is rejected", () => {
      rejectingPH()
      const { result, onCommit } = dictate()

      act(() => result.current.start())
      act(() => live.fail("language-not-supported"))
      act(() => live.end())
      act(() => live.fail("language-not-supported"))
      act(() => live.end())

      expect(result.current.error).toBe("language-not-supported")
      expect(result.current.state).toBe("idle")
      expect(onCommit).not.toHaveBeenCalled()
    })

    it("clears the failure once a later Dictation starts", () => {
      rejectingPH()
      const { result } = dictate()

      act(() => result.current.start())
      act(() => live.fail("language-not-supported"))
      act(() => live.end())
      act(() => live.fail("language-not-supported"))
      act(() => live.end())
      act(() => result.current.start())

      expect(result.current.error).toBeNull()
    })
  })

  /**
   * Project and campaign names are exactly what a generic model mangles.
   * Biasing is a hint to the recogniser, not a restriction on what it may
   * hear — anything can still be dictated.
   */
  describe("priming the recogniser with project titles", () => {
    class StubPhrase {
      constructor(phrase, boost) {
        this.phrase = phrase
        this.boost = boost
      }
    }

    const withPhrases = () => vi.stubGlobal("SpeechRecognitionPhrase", StubPhrase)
    const withoutPhrases = () => vi.stubGlobal("SpeechRecognitionPhrase", undefined)

    it("boosts the titles the employee actually uses", () => {
      install()
      withPhrases()
      const { result } = dictate({ phrases: ["Ortigas Fitout", "Cebu Rollout"] })

      act(() => result.current.start())

      expect(live.phrases).toEqual([
        { phrase: "Ortigas Fitout", boost: 3 },
        { phrase: "Cebu Rollout", boost: 3 },
      ])
    })

    it("drops blank titles rather than boosting empty strings", () => {
      install()
      withPhrases()
      const { result } = dictate({ phrases: ["Ortigas Fitout", "  ", ""] })

      act(() => result.current.start())

      expect(live.phrases).toHaveLength(1)
    })

    /** Biasing across hundreds of phrases degrades accuracy rather than helping. */
    it("caps how many titles it will bias on", () => {
      install()
      withPhrases()
      const many = Array.from({ length: 200 }, (_, i) => `Project ${i}`)
      const { result } = dictate({ phrases: many })

      act(() => result.current.start())

      expect(live.phrases.length).toBeLessThanOrEqual(50)
    })

    it("dictates perfectly well on a browser that cannot bias", () => {
      install()
      withoutPhrases()
      const { result, onCommit } = dictate({ phrases: ["Ortigas Fitout"] })

      act(() => result.current.start())
      act(() => live.emit([["Replaced the office switch.", true]]))
      act(() => result.current.stop())
      act(() => live.end())

      expect(live.started).toBe(1)
      expect(onCommit).toHaveBeenCalledWith("Replaced the office switch.")
    })
  })
})
