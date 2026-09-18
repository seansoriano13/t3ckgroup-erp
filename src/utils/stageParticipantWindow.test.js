import { describe, expect, it } from "vitest"
import { findClosingMove, windowClosesOnMove } from "./stageParticipantWindow"

describe("windowClosesOnMove", () => {
  it("stage_left closes when the calling Stage is left", () => {
    const window = { untilRule: "stage_left", callingStageId: "proposal" }

    expect(windowClosesOnMove(window, { fromStageId: "proposal", toStageId: "won" })).toBe(true)
    expect(windowClosesOnMove(window, { fromStageId: "won", toStageId: "closed" })).toBe(false)
  })

  it("stage_entered closes only when the chosen Stage is entered", () => {
    const window = { untilRule: "stage_entered", untilStageId: "delivery", callingStageId: "proposal" }

    expect(windowClosesOnMove(window, { fromStageId: "proposal", toStageId: "negotiation" })).toBe(false)
    expect(windowClosesOnMove(window, { fromStageId: "negotiation", toStageId: "delivery" })).toBe(true)
  })

  it("later_stage_left closes only when the chosen Stage is left", () => {
    const window = { untilRule: "later_stage_left", untilStageId: "delivery", callingStageId: "proposal" }

    expect(windowClosesOnMove(window, { fromStageId: "proposal", toStageId: "delivery" })).toBe(false)
    expect(windowClosesOnMove(window, { fromStageId: "delivery", toStageId: "invoicing" })).toBe(true)
  })

  it("a loop back before the chosen Stage keeps the window open", () => {
    const window = { untilRule: "later_stage_left", untilStageId: "delivery", callingStageId: "proposal" }

    // proposal -> negotiation -> proposal -> negotiation -> delivery
    expect(findClosingMove(window, [
      { fromStageId: "proposal", toStageId: "negotiation" },
      { fromStageId: "negotiation", toStageId: "proposal" },
      { fromStageId: "proposal", toStageId: "negotiation" },
      { fromStageId: "negotiation", toStageId: "delivery" },
    ])).toBe(null)
  })

  it("terminal never closes on its own move but any move flagged terminal closes it", () => {
    const window = { untilRule: "terminal", callingStageId: "proposal" }

    expect(windowClosesOnMove(window, { fromStageId: "proposal", toStageId: "negotiation" })).toBe(false)
    expect(windowClosesOnMove(window, { fromStageId: "negotiation", toStageId: "won", isTerminalMove: true })).toBe(
      true,
    )
  })

  it("reaching a Terminal Stage closes every rule regardless of its own condition", () => {
    const rules = ["stage_left", "stage_entered", "later_stage_left", "terminal"];
    for (const untilRule of rules) {
      const window = { untilRule, untilStageId: "somewhere-else", callingStageId: "proposal" }
      expect(
        windowClosesOnMove(window, { fromStageId: "negotiation", toStageId: "won", isTerminalMove: true }),
      ).toBe(true)
    }
  })
})

describe("findClosingMove", () => {
  it("returns the index of the move that closes the window", () => {
    const window = { untilRule: "stage_entered", untilStageId: "delivery", callingStageId: "proposal" }
    const moves = [
      { fromStageId: "proposal", toStageId: "negotiation" },
      { fromStageId: "negotiation", toStageId: "delivery" },
    ]

    expect(findClosingMove(window, moves)).toBe(1)
  })

  it("returns null when no move in the sequence closes it", () => {
    const window = { untilRule: "stage_entered", untilStageId: "delivery", callingStageId: "proposal" }
    const moves = [{ fromStageId: "proposal", toStageId: "negotiation" }]

    expect(findClosingMove(window, moves)).toBe(null)
  })
})
