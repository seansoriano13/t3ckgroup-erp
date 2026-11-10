import { describe, it, expect } from "vitest"
import { prepareDemoActions, DEMO_TITLE_FIXES } from "../../../scripts/lib/demoActions.mjs"

// #896: the demo copy must not carry a Group Task member staging does not have
// (the DELCOM action failed at the demo for that reason), and its titles must
// use template tokens, not the literal labels production was typed with.

const KNOWN = "11111111-1111-4111-8111-111111111111"
const GONE = "abb28da5-0000-4000-8000-000000000000"
const OTHER = "22222222-2222-4222-8222-222222222222"

function groupTask(title, members) {
  return { kind: "create_group_task", config: { title, members } }
}

describe("prepareDemoActions: members", () => {
  it("drops a member staging does not have and keeps the others", () => {
    const actions = [groupTask("Kickoff", [{ employeeId: KNOWN }, { employeeId: GONE }])]

    const { droppedMembers } = prepareDemoActions(actions, new Set([KNOWN]))

    expect(actions[0].config.members).toEqual([{ employeeId: KNOWN }])
    expect(droppedMembers).toEqual([{ action: "Kickoff", employeeId: GONE }])
  })

  it("leaves an action alone when every member is on staging", () => {
    const members = [{ employeeId: KNOWN }, { employeeId: OTHER }]
    const actions = [groupTask("Kickoff", members)]

    const { droppedMembers } = prepareDemoActions(actions, new Set([KNOWN, OTHER]))

    expect(droppedMembers).toEqual([])
    expect(actions[0].config.members).toEqual(members)
  })

  it("refuses an action whose only members are all missing, so the task does not land on whoever moves the SOR", () => {
    const actions = [groupTask("DELCOM", [{ employeeId: GONE }])]

    expect(() => prepareDemoActions(actions, new Set([KNOWN]))).toThrow(/"DELCOM" has no member left on staging/)
  })

  it("keeps an action that never had members (the runtime default is the mover, and that is intended)", () => {
    const actions = [groupTask("Open", [])]

    expect(() => prepareDemoActions(actions, new Set())).not.toThrow()
    expect(actions[0].config.members).toEqual([])
  })

  it("ignores actions that are not group tasks", () => {
    const actions = [{ kind: "create_individual_task", config: { loggedById: GONE } }]

    const { droppedMembers } = prepareDemoActions(actions, new Set())

    expect(droppedMembers).toEqual([])
    expect(actions[0].config.loggedById).toBe(GONE)
  })
})

describe("prepareDemoActions: titles", () => {
  it("swaps the DELCOM literal labels for template tokens", () => {
    const actions = [
      groupTask("DELCOM - (Sales Order Number) - (Agency Name) - (Bidder Company)", [{ employeeId: KNOWN }]),
    ]

    const { retitled } = prepareDemoActions(actions, new Set([KNOWN]))

    expect(actions[0].config.title).toBe("DELCOM - {{so_number}} - {{company}} - {{project_title}}")
    expect(retitled).toEqual([
      {
        action: "DELCOM - (Sales Order Number) - (Agency Name) - (Bidder Company)",
        from: "DELCOM - (Sales Order Number) - (Agency Name) - (Bidder Company)",
        to: "DELCOM - {{so_number}} - {{company}} - {{project_title}}",
      },
    ])
  })

  it("also fixes titleTemplate, the field the editor writes when it is set", () => {
    const actions = [{ kind: "create_group_task", config: { titleTemplate: "BIDCOM - (Sales Order Number)", members: [{ employeeId: KNOWN }] } }]

    prepareDemoActions(actions, new Set([KNOWN]))

    expect(actions[0].config.titleTemplate).toBe("BIDCOM - {{so_number}}")
  })

  it("leaves titles that already use tokens, or have no labels, untouched", () => {
    const actions = [groupTask("BIDCOM - {{so_number}} {{project_title}}", [])]

    const { retitled } = prepareDemoActions(actions, new Set())

    expect(retitled).toEqual([])
    expect(actions[0].config.title).toBe("BIDCOM - {{so_number}} {{project_title}}")
  })

  it("knows every label it swaps, and each one maps to a token the app renders", () => {
    expect(DEMO_TITLE_FIXES.map(([from]) => from)).toEqual([
      "(Sales Order Number)",
      "(Agency Name)",
      "(Bidder Company)",
    ])
    for (const [, to] of DEMO_TITLE_FIXES) expect(to).toMatch(/^\{\{[a-z_]+\}\}$/)
  })
})
