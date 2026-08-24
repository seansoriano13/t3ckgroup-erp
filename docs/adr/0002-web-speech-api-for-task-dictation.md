# Web Speech API for Task Dictation

## Status
Accepted

## Context
Employees log DTARs by typing a task description into a plain textarea in the Log Task
modal. Dictation was proposed to reduce that typing, particularly for staff logging work
from a phone after a site visit.

The obvious implementation is the one already sitting in the codebase: `aiService.js`
constructs a `GoogleGenerativeAI` client from `VITE_GEMINI_API_KEY`, and Gemini's
multimodal models transcribe audio. A future reader will find that client, notice
dictation does not use it, and reasonably assume the option was never considered.

It was considered, and initially chosen. The reasoning that reversed it is the reason
this ADR exists.

The first pass assumed spoken input would be Taglish — English technical nouns dropped
into Tagalog sentence frames. That assumption eliminates the Web Speech API outright:
`SpeechRecognition.lang` takes a single BCP-47 code and has no code-switching mode. An
LLM transcriber handles code-switching well; a phoneme-matching ASR does not.

That assumption was wrong for this surface. DTAR descriptions are written in English.
Once the language premise was corrected, the constraint that ruled out Web Speech
disappeared, and a browser-native API with no key, no vendor, no per-minute cost, and no
server round-trip became the better choice.

## Decision
1. **Use the browser's Web Speech API** (`SpeechRecognition`, feature-detected unprefixed
   first, then `webkitSpeechRecognition`) rather than Gemini or any cloud STT service.
   No API key, no Edge Function, no new vendor, no marginal cost per dictation.
2. **`lang = "en-PH"`**, falling back to `en-US` where unsupported. Philippine English
   phonology and local proper nouns degrade noticeably under a generic `en-US` model.
3. **Prefer on-device recognition.** Attempt `processLocally = true` gated on
   `SpeechRecognition.available()`; fall back to the platform's cloud service when the
   language pack is `unavailable`, and kick off `install()` in the background when it is
   `downloadable` rather than blocking the user on a download mid-task. The one-time
   disclosure that audio leaves the device fires **only on the cloud path**, so the
   notice is shown exactly when it is true.
4. **Seed contextual biasing from existing project titles.** `recognition.phrases` is
   populated from the `useProjectTitles` list already fetched for the title datalist,
   at a uniform boost of 3.0, capped in length. Skipped silently where
   `SpeechRecognitionPhrase` is undefined — it is a pure enhancement.
5. **Retain no audio.** A Dictation produces a Transcript and nothing else. There is no
   stored recording, and therefore no retention policy, no playback, and no deletion
   story. See `CONTEXT.md`.
6. **Verbatim, appended, unconfirmed.** Only `isFinal` results are buffered; the
   concatenated Transcript is appended to the end of the existing description on stop.
   No model rewrites it, no confirm step gates it, and nothing records that a given
   description was spoken rather than typed.
7. **Hide the affordance where unsupported.** No disabled button, no tooltip blaming the
   user's browser.

## Considered Options
- **Gemini multimodal audio** — rejected once the language premise was corrected. Its
  decisive advantage was Taglish handling, which this surface does not need. Retained
  costs: per-minute billing, and an API key that either ships to the browser (as
  `aiService.js` does today) or needs an Edge Function (as `odoo-sor-lookup` insists on).
  Choosing Web Speech deleted that question entirely rather than answering it.
- **Google Cloud Speech-to-Text v2 / Deepgram / Whisper** — rejected as a new vendor
  surface with no advantage over either of the above for English dictation.
- **Retaining the audio as a task attachment** — rejected. It converts a text-entry
  convenience into a workforce surveillance artifact. The Transcript is verbatim and
  user-editable, so the employee is the reviewer; no supervisor needs playback.
- **A confirm/preview step before insertion** — rejected. It doubles the taps on every
  successful dictation to defend against a minority case, and appending at the end
  already makes a bad Transcript trivially deletable.
- **Live streaming interim results into the textarea** — rejected in favour of
  record-then-insert. Interim results are still enabled, but only to drive the button's
  "listening" state, never to write into the field.

## Consequences
- **Firefox users get nothing.** Firefox 142 (19 Aug 2025) added `SpeechRecognition`, but
  behind the `media.webspeech.recognition.enable` pref, off by default, and Mozilla has
  stated it will not ship broadly without standards consensus. The API is implemented and
  switched off — not absent. If Firefox becomes common among staff, this decision needs
  revisiting, not patching.
- **On the cloud fallback path, audio reaches the browser vendor's servers** (Google for
  Chrome, Apple for Safari). Choosing a browser-native API moved that transfer from
  explicit to implicit; it did not remove it. Hence decision 3's conditional disclosure.
- **English only, by construction.** If DTAR descriptions ever legitimately contain
  Tagalog or Taglish, this decision fails and the Gemini path above is the way back.
  That is the single condition that should reopen this ADR.
- **The `@google/generative-ai` dependency remains stale regardless.** It is marked legacy
  in its own README with an EOL of 31 Aug 2025 and is superseded by `@google/genai`.
  Dictation no longer depends on it, which removes one reason to migrate but does not
  remove the debt.
