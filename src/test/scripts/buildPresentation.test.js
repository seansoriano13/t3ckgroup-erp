import { describe, it, expect } from "vitest"
import {
  enforceSorVocabulary,
  entriesSince,
  buildRoadmap,
  buildPresentation,
} from "../../../scripts/lib/presentation.mjs"

// The Release Notes deck renders published changelog copy verbatim in front of
// an audience, and CONTEXT.md forbids "Deal" as a name for an SOR. We correct
// it on the way out rather than rewriting entries employees have already seen
// (ADR 0022), so the correction has to survive the glossary terms that legally
// contain the word.

describe("enforceSorVocabulary", () => {
  it("replaces the plural", () => {
    expect(enforceSorVocabulary("without altering live deals")).toBe(
      "without altering live SORs",
    )
  })

  it("replaces the singular and fixes the article", () => {
    expect(enforceSorVocabulary("a deal's own history notes")).toBe(
      "an SOR's own history notes",
    )
    expect(enforceSorVocabulary("A deal pins to a version")).toBe(
      "An SOR pins to a version",
    )
  })

  it("leaves Deal Team and Deal Owner alone - they are glossary terms", () => {
    expect(
      enforceSorVocabulary("The rest of the SOR, including the Deal Team, stays"),
    ).toBe("The rest of the SOR, including the Deal Team, stays")
    expect(enforceSorVocabulary("80% Deal Owner, 20% Sales Director")).toBe(
      "80% Deal Owner, 20% Sales Director",
    )
  })

  // The article rule starts matching one character before the protected
  // phrase does, so without a guard "a Deal Team" is rewritten to
  // "an SOR Team" — the substitution destroys the very term it protects.
  it("does not let the article rule eat a protected term that follows it", () => {
    expect(enforceSorVocabulary("a Deal Team")).toBe("a Deal Team")
    expect(enforceSorVocabulary("Assign a Deal Owner to the SOR")).toBe(
      "Assign a Deal Owner to the SOR",
    )
    expect(enforceSorVocabulary("A Deal Team owns it")).toBe("A Deal Team owns it")
  })

  it("capitalises the role when the source lower-cased it", () => {
    expect(
      enforceSorVocabulary("edit the details (client name, buyer, amount, deal owner)"),
    ).toBe("edit the details (client name, buyer, amount, Deal Owner)")
  })

  it("handles a title", () => {
    expect(enforceSorVocabulary("Deal Visibility Now Enforced by the Server")).toBe(
      "SOR Visibility Now Enforced by the Server",
    )
  })

  it("does not maul words that merely contain 'deal'", () => {
    expect(enforceSorVocabulary("a dealer and the dealings")).toBe(
      "a dealer and the dealings",
    )
  })

  it("leaves copy with no offending word untouched", () => {
    const clean = "Stage Fields now block a move before you click."
    expect(enforceSorVocabulary(clean)).toBe(clean)
  })
})

describe("entriesSince", () => {
  const log = [
    { date: "2026-09-15", version: "1.7.17", title: "C", changes: ["c"] },
    { date: "2026-09-09", version: "1.7.8", title: "B", changes: ["b"] },
    { date: "2026-09-08", version: "1.7.5", title: "A", changes: ["a"] },
  ]

  it("keeps entries on or after the since date", () => {
    expect(entriesSince(log, "2026-09-09").map((e) => e.version)).toEqual([
      "1.7.17",
      "1.7.8",
    ])
  })

  it("is inclusive of the boundary day", () => {
    expect(entriesSince(log, "2026-09-15").map((e) => e.version)).toEqual(["1.7.17"])
  })

  it("returns nothing when the window starts after everything", () => {
    expect(entriesSince(log, "2026-10-01")).toEqual([])
  })
})

describe("buildRoadmap", () => {
  // Shape mirrors `gh issue list --json number,title`: a flat list of what is
  // still open. The epics file says which numbers hang off which parent, so a
  // ticket closed since the last snapshot simply stops appearing and the
  // fraction moves on its own.
  const issues = [
    { number: 206, title: "CRM register" },
    { number: 288, title: "Board redesign" },
    { number: 289, title: "Deleted bin" },
    { number: 241, title: "IPAS v1" },
    { number: 242, title: "Raise an IPAS" },
  ]

  const epics = [
    {
      phase: "Finish CRM",
      number: 206,
      title: "CRM register",
      unlocks: "The register stops being a list.",
      tickets: [286, 287, 288, 289, 290],
    },
    {
      phase: "IPAS v1",
      number: 241,
      title: "IPAS v1",
      unlocks: "Every Odoo purchase order is recorded.",
      tickets: [242, 243],
    },
  ]

  it("counts shipped tickets as total minus still-open", () => {
    const { phases } = buildRoadmap(issues, epics)
    const crm = phases[0].epics[0]
    expect(crm.total).toBe(5)
    expect(crm.done).toBe(3) // 286, 287 and 290 are no longer open
    expect(crm.open).toEqual([288, 289])
  })

  it("groups epics under their phase, in the order the epics file gives", () => {
    const { phases } = buildRoadmap(issues, epics)
    expect(phases.map((p) => p.name)).toEqual(["Finish CRM", "IPAS v1"])
  })

  it("totals every open ticket and epic across the roadmap", () => {
    const { openCount, epicCount, ticketCount } = buildRoadmap(issues, epics)
    expect(epicCount).toBe(2)
    expect(ticketCount).toBe(7)
    // 288, 289 and 242, plus the two epic parents themselves
    expect(openCount).toBe(5)
  })

  // `openCount` includes the epic parents, so a screen that calls it a ticket
  // count claims more open tickets than the roadmap has tickets. The count of
  // tickets alone is reported separately rather than being recomputed by
  // whatever renders it.
  it("counts open tickets apart from the epics that parent them", () => {
    const { openTicketCount, ticketCount } = buildRoadmap(issues, epics)
    expect(openTicketCount).toBe(3) // 288, 289, 242 — not #206 or #241
    expect(openTicketCount).toBeLessThanOrEqual(ticketCount)
  })

  it("does not count a declared-shipped ticket as still open", () => {
    const { openTicketCount } = buildRoadmap(issues, [
      { ...epics[0], shipped: [288] },
      epics[1],
    ])
    expect(openTicketCount).toBe(2) // 289 and 242
  })

  it("corrects the glossary in epic copy and in GitHub's own issue titles", () => {
    const { phases } = buildRoadmap(
      [{ number: 288, title: "Board redesign: drag a deal between columns" }],
      [
        {
          phase: "Finish CRM",
          number: 206,
          title: "The deal register",
          unlocks: "Every deal in one place.",
          tickets: [288],
        },
      ],
    )
    const epic = phases[0].epics[0]
    expect(epic.title).toBe("The SOR register")
    expect(epic.unlocks).toBe("Every SOR in one place.")
    expect(epic.tickets[0].title).toBe("Board redesign: drag an SOR between columns")
  })

  it("reports a barely-started epic honestly", () => {
    const { phases } = buildRoadmap(issues, epics)
    expect(phases[1].epics[0].done).toBe(1) // 243 closed, 242 open
  })

  // #286/#287/#288/#290 shipped in two commits that referenced the parent as
  // "#206 part 1/2", so GitHub never closed them. Counting purely from the
  // snapshot would report finished work as outstanding — the opposite of the
  // failure the fraction exists to prevent.
  describe("tickets that shipped without their issue being closed", () => {
    const withShipped = [{ ...epics[0], shipped: [288] }, epics[1]]

    it("counts a declared-shipped ticket as done even while its issue is open", () => {
      const { phases } = buildRoadmap(issues, withShipped)
      expect(phases[0].epics[0].done).toBe(4)
      expect(phases[0].epics[0].open).toEqual([289])
    })

    it("flags the ticket so the screen can say the issue is still open", () => {
      const { phases } = buildRoadmap(issues, withShipped)
      const ticket = phases[0].epics[0].tickets.find((t) => t.number === 288)
      expect(ticket).toMatchObject({ open: true, shipped: true })
    })

    it("does not double-count a ticket that is both declared shipped and closed", () => {
      const { phases } = buildRoadmap(issues, [
        { ...epics[0], shipped: [286, 288] },
        epics[1],
      ])
      expect(phases[0].epics[0].done).toBe(4)
    })

    it("still counts every open issue, shipped or not", () => {
      const { openCount } = buildRoadmap(issues, withShipped)
      expect(openCount).toBe(5)
    })
  })
})

describe("buildPresentation", () => {
  const changelog = [
    {
      date: "2026-09-11",
      version: "1.7.12",
      title: "Publish vX.Y",
      changes: ["Versions now carry meaning for deals on the old version."],
    },
    {
      date: "2026-09-01",
      version: "1.6.0",
      title: "Too old",
      changes: ["Should not appear."],
    },
  ]

  const supplement = {
    since: "2026-09-09",
    headline: [
      {
        id: "flow-versioning",
        block: "Flow Canvas",
        title: "Published versions, safely",
        impact: "A published flow can be rolled back without touching live SORs.",
        version: "1.7.12",
        issues: [188],
        sample: "flow-versioning",
      },
      {
        id: "crm-board",
        block: "CRM",
        title: "CRM, and a board you can drag across",
        impact: "Dragging was impossible before; the guard moved into the move.",
        changes: ["One column per Sale Type.", "Drag a deal to move it."],
        issues: [206, 288],
        sample: "crm-board",

      },
    ],
    underTheHood: {
      summary: "Fixes and safety changes.",
      items: [{ title: "Migrations are append-only", issues: [184], sample: "migrations" }],
    },
    epics: [
      {
        phase: "Finish CRM",
        number: 206,
        title: "CRM register",
        unlocks: "x",
        tickets: [288],
      },
    ],
    prototypes: [
      {
        id: "ipas",
        title: "Printed IPAS",
        file: "/prototypes/printed-ipas.html",
        variants: ["A", "B", "C"],
        epic: 241,
      },
    ],
  }

  const issues = [
    { number: 206, title: "CRM register" },
    { number: 288, title: "Board" },
  ]

  const built = buildPresentation({
    changelog,
    supplement,
    issues,
    generatedAt: "2026-09-16T10:00:00.000Z",
  })

  it("pulls detail bullets from the changelog when the row names a version", () => {
    expect(built.headline[0].changes).toEqual([
      "Versions now carry meaning for SORs on the old version.",
    ])
  })

  it("uses the supplement's own bullets when the changelog never recorded it", () => {
    expect(built.headline[1].changes).toEqual([
      "One column per Sale Type.",
      "Drag an SOR to move it.",
    ])
  })

  it("keeps the supplement's order, not the changelog's", () => {
    expect(built.headline.map((h) => h.id)).toEqual(["flow-versioning", "crm-board"])
  })

  it("carries the generation timestamp so a stale deck is visible, not assumed", () => {
    expect(built.generatedAt).toBe("2026-09-16T10:00:00.000Z")
    expect(built.since).toBe("2026-09-09")
  })

  it("refuses a row whose named version is not in the changelog window", () => {
    expect(() =>
      buildPresentation({
        changelog,
        supplement: {
          ...supplement,
          headline: [{ id: "x", block: "b", title: "t", impact: "i", version: "9.9.9", sample: "s" }],
        },
        issues,
        generatedAt: "2026-09-16T10:00:00.000Z",
      }),
    ).toThrow(/9\.9\.9/)
  })

  it("refuses a row with no detail at all, rather than rendering an empty card", () => {
    expect(() =>
      buildPresentation({
        changelog,
        supplement: {
          ...supplement,
          headline: [{ id: "x", block: "b", title: "t", impact: "i", sample: "s" }],
        },
        issues,
        generatedAt: "2026-09-16T10:00:00.000Z",
      }),
    ).toThrow(/x/)
  })

  it("carries each fix's before-and-after sample through", () => {
    expect(built.underTheHood.items[0].sample).toBe("migrations")
  })

  // A fix is a slide of its own; a slide with nothing to show is a claim.
  it("refuses a fix that names no sample", () => {
    expect(() =>
      buildPresentation({
        changelog,
        supplement: { ...supplement, underTheHood: { summary: "s", items: [{ title: "Toasts stay clickable" }] } },
        issues,
        generatedAt: "2026-09-16T10:00:00.000Z",
      }),
    ).toThrow(/Toasts stay clickable/)
  })

  it("carries prototypes and the roadmap through", () => {
    expect(built.prototypes).toHaveLength(1)
    expect(built.roadmap.phases[0].epics[0].done).toBe(0)
  })
})
