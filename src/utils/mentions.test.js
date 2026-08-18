import { describe, expect, it } from "vitest"
import { activeMentionQuery } from "./mentions"

/**
 * What counts as "the user is typing a mention right now".
 *
 * Getting this wrong is not a cosmetic bug: a false positive pops a list over
 * the note the user is writing, and a false negative means the @ they typed
 * quietly notifies nobody.
 */
describe("detecting a mention in progress", () => {
  const at = (text) => activeMentionQuery(text, text.length)

  it("catches an @ at the start of a note", () => {
    expect(at("@cja")).toMatchObject({ at: 0, token: "cja" })
  })

  it("catches an @ mid-sentence", () => {
    expect(at("can you source this @raq")).toMatchObject({ token: "raq" })
  })

  it("allows one space, so a full name keeps matching", () => {
    expect(at("@Cjay Esp")).toMatchObject({ token: "Cjay Esp" })
  })

  it("gives up after two words, rather than treating a sentence as a name", () => {
    expect(at("@Cjay Espina please check")).toBeNull()
  })

  it("ignores an email address", () => {
    // "name@company.com" has no whitespace before the @, so it is not a
    // mention — otherwise typing any address opens the picker.
    expect(at("mail me at sean@t3ck.com")).toBeNull()
  })

  it("stops at a newline", () => {
    expect(at("@cjay\nsecond line")).toBeNull()
  })

  it("is null when there is no @ at all", () => {
    expect(at("just a normal note")).toBeNull()
  })

  it("reads from the caret, not the end of the text", () => {
    const text = "@raq and some trailing words"
    // Caret sits right after "@raq".
    expect(activeMentionQuery(text, 4)).toMatchObject({ token: "raq" })
  })

  it("offers everyone on a bare @", () => {
    expect(at("@")).toMatchObject({ token: "" })
  })
})
