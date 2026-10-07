import { describe, expect, it } from "vitest"
import { liveMentionIds, mentionWindowHint } from "./mentionWindowHint"

const raquel = { id: "r", name: "Raquel Buyer" }
const jo = { id: "j", name: "Jo Tech" }
const me = { id: "me", name: "Sean" }

describe("liveMentionIds", () => {
  it("keeps only people still named in the text, never the writer", () => {
    expect(liveMentionIds([raquel, jo, me], "hi @Raquel Buyer and @Sean", "me")).toEqual(["r"])
  })
})

describe("mentionWindowHint", () => {
  it("names who a Mention opens the Stage to", () => {
    expect(mentionWindowHint([raquel, jo], ["r"], { hasVisits: true })).toBe("Raquel Buyer gets access to this Stage until it moves.")
    expect(mentionWindowHint([raquel, jo], ["r", "j"], { hasVisits: true })).toBe("Raquel Buyer and Jo Tech get access to this Stage until it moves.")
  })

  it("says read-only access to the SOR when it has no Stage Visit", () => {
    expect(mentionWindowHint([raquel], ["r"], { hasVisits: false })).toBe("Raquel Buyer gets read-only access to this SOR.")
  })

  it("says nothing when no one gains access", () => {
    expect(mentionWindowHint([raquel], [], { hasVisits: true })).toBeNull()
  })
})
