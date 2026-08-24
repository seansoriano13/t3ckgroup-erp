import { describe, expect, it } from "vitest"
import {
  activeStages,
  anchorStage,
  formatLeadSource,
  formatPHP,
  isAnchorCode,
  isLostCode,
  isOpenRegionStage,
  isRealizedCode,
  isRealizedStage,
  isTerminalStage,
  isWonCode,
  renderableStages,
  stageByCode,
  isValidSalesReference,
  normalizeSalesReference,
  OPPORTUNITY_STAGES,
  OPPORTUNITY_STATUS,
  PIPELINE_STAGE_SEED,
  PROJECT_TYPE_LABELS,
  PROJECT_TYPE_SHORT,
  itbGateSatisfiedBy,
  itbGateStage,
  realizedStageCodes,
  REALIZED_STAGES,
  requiresItbNumber,
  requiresSalesReference,
  STAGE_LABELS,
} from "./sor"

/**
 * Sales Opportunity Registration rules, fixed by policy CCPR-2026-001. These
 * gate whether a deal may advance and how money is shown to salespeople, so the
 * expected values here come from the policy text quoted in sor.js, not from
 * re-running the implementation.
 */
describe("sales reference validation", () => {
  it("accepts an Odoo quotation number", () => {
    expect(isValidSalesReference("S01237")).toBe(true)
  })

  it("accepts a reference typed in lower case or with stray spaces", () => {
    expect(isValidSalesReference("  s01237 ")).toBe(true)
    expect(normalizeSalesReference("  s01237 ")).toBe("S01237")
  })

  it("rejects anything that is not S followed by digits", () => {
    expect(isValidSalesReference("01237")).toBe(false)
    expect(isValidSalesReference("S")).toBe(false)
    expect(isValidSalesReference("SO1237")).toBe(false)
    expect(isValidSalesReference("S01237-A")).toBe(false)
    expect(isValidSalesReference("QS01237")).toBe(false)
  })

  it("rejects an empty or missing reference", () => {
    expect(isValidSalesReference("")).toBe(false)
    expect(isValidSalesReference(null)).toBe(false)
    expect(isValidSalesReference(undefined)).toBe(false)
  })

  it("normalises a missing value to an empty string rather than throwing", () => {
    expect(normalizeSalesReference(null)).toBe("")
    expect(normalizeSalesReference(undefined)).toBe("")
  })
})

describe("stage gating on sales reference", () => {
  it("requires a reference to leave Lead for any active stage", () => {
    expect(requiresSalesReference("LEAD", "QUALIFIED")).toBe(true)
    expect(requiresSalesReference("LEAD", "PROPOSAL_SUBMITTED")).toBe(true)
    expect(requiresSalesReference("LEAD", "CLOSED_WON")).toBe(true)
  })

  it("lets a lead be closed as lost before it was ever quoted", () => {
    expect(requiresSalesReference("LEAD", "CLOSED_LOST")).toBe(false)
  })

  it("does not gate a move that stays in Lead", () => {
    expect(requiresSalesReference("LEAD", "LEAD")).toBe(false)
  })

  it("does not gate moves between later stages", () => {
    // Rows registered before the field existed keep advancing.
    expect(requiresSalesReference("QUALIFIED", "AWARDED")).toBe(false)
    expect(requiresSalesReference("NEGOTIATION", "CLOSED_LOST")).toBe(false)
    expect(requiresSalesReference("AWARDED", "PO_RECEIVED")).toBe(false)
  })
})

describe("pipeline definition", () => {
  it("lists the default pipeline in order", () => {
    // Twelve from Annex C.3, plus For Bidding and Payment Verification, which
    // the business runs but the policy never named.
    expect(OPPORTUNITY_STAGES.map((s) => s.value)).toEqual([
      "LEAD",
      "PROPOSAL_SUBMITTED",
      "QUALIFIED",
      "FOR_BIDDING",
      "BID_SUBMITTED",
      "NEGOTIATION",
      "AWARDED",
      "PAYMENT_VERIFICATION",
      "PO_RECEIVED",
      "PROJECT_DELIVERY",
      "COLLECTION",
      "CLOSED_WON",
      "RETENTION",
      "CLOSED_LOST",
    ])
  })

  it("gives every stage a human label", () => {
    expect(STAGE_LABELS[OPPORTUNITY_STATUS.PROPOSAL_SUBMITTED]).toBe("Proposal Submitted")
    expect(STAGE_LABELS[OPPORTUNITY_STATUS.PO_RECEIVED]).toBe("PO Received")
    expect(STAGE_LABELS[OPPORTUNITY_STATUS.CLOSED_LOST]).toBe("Closed Lost")
  })

  it("labels the three sales divisions", () => {
    expect(PROJECT_TYPE_LABELS.SSP).toBe("SSP — Single Salesperson Project")
    expect(PROJECT_TYPE_SHORT.STRATEGIC).toBe("Strategic")
  })

  it("identifies realized stages as the anchor and everything after it, less lost", () => {
    // Payment Verification joined this set when it was added after Awarded.
    // That is the intended consequence of putting a stage past the anchor: the
    // deal is awarded and priced, so accounting still checking the payment
    // does not move it back into the Projected pool.
    expect(REALIZED_STAGES).toEqual([
      "AWARDED",
      "PAYMENT_VERIFICATION",
      "PO_RECEIVED",
      "PROJECT_DELIVERY",
      "COLLECTION",
      "CLOSED_WON",
      "RETENTION",
    ])
  })
})

describe("formatPHP", () => {
  it("renders a peso amount with two decimals and thousands separators", () => {
    expect(formatPHP(1234.5)).toBe("₱1,234.50")
    expect(formatPHP(1000000)).toBe("₱1,000,000.00")
  })

  it("renders zero for a missing amount instead of NaN", () => {
    expect(formatPHP(null)).toBe("₱0.00")
    expect(formatPHP(undefined)).toBe("₱0.00")
    expect(formatPHP("")).toBe("₱0.00")
  })

  it("accepts the numeric string Postgres returns for a numeric column", () => {
    expect(formatPHP("2500.75")).toBe("₱2,500.75")
  })

  it("rounds to two decimals", () => {
    expect(formatPHP(0.005)).toBe("₱0.01")
    expect(formatPHP(99.999)).toBe("₱100.00")
  })
})

describe("formatLeadSource", () => {
  const leadSources = [
    { value: "LGU", label: "LGU" },
    { value: "REPEAT_CLIENT", label: "Repeat Client" },
  ]

  it("resolves the label from the dynamic lead source register", () => {
    expect(formatLeadSource("REPEAT_CLIENT", null, leadSources)).toBe("Repeat Client")
  })

  it("appends the free-text detail when one was recorded", () => {
    expect(formatLeadSource("LGU", "Quezon City", leadSources)).toBe("LGU - Quezon City")
  })

  it("falls back to the raw value for a source no longer in the register", () => {
    expect(formatLeadSource("EXHIBITION", null, leadSources)).toBe("EXHIBITION")
  })

  it("shows a dash when there is no source at all", () => {
    expect(formatLeadSource(null, null, leadSources)).toBe("—")
  })

  it("works before the register has loaded", () => {
    expect(formatLeadSource("LGU", null)).toBe("LGU")
  })
})

/**
 * The pipeline is moving from a hard-coded list into `crm_pipeline_stages`, so
 * the default stages become the *seed* and the fallback rather than the source
 * of truth. Nothing that carries money is stored as a per-stage
 * toggle: Realized/Projected is derived from where a stage sits relative to
 * the Anchor Stage, so no settings screen can move a deal between the two.
 */
describe("pipeline stage seed", () => {
  it("seeds the same stages the compatibility view exposes, in the same order", () => {
    expect(PIPELINE_STAGE_SEED.map((s) => s.code)).toEqual(
      OPPORTUNITY_STAGES.map((s) => s.value),
    )
  })

  it("marks every seeded stage as system-owned so none can be retired from a settings screen", () => {
    expect(PIPELINE_STAGE_SEED.every((s) => s.is_system)).toBe(true)
    expect(PIPELINE_STAGE_SEED.every((s) => s.is_active)).toBe(true)
  })

  it("orders stages with gaps so inserting one never renumbers the others", () => {
    const orders = PIPELINE_STAGE_SEED.map((s) => s.sort_order)
    expect(orders).toEqual([...orders].sort((a, b) => a - b))
    expect(new Set(orders).size).toBe(orders.length)
    // A gap between every adjacent pair leaves room for an insert.
    for (let i = 1; i < orders.length; i++) {
      expect(orders[i] - orders[i - 1]).toBeGreaterThan(1)
    }
  })

  it("names exactly one anchor, one won, one lost and one default stage", () => {
    const only = (flag) => PIPELINE_STAGE_SEED.filter((s) => s[flag])
    expect(only("is_anchor").map((s) => s.code)).toEqual(["AWARDED"])
    expect(only("is_won").map((s) => s.code)).toEqual(["CLOSED_WON"])
    expect(only("is_lost").map((s) => s.code)).toEqual(["CLOSED_LOST"])
    // `sales_opportunities.status` defaults to this stage, which is also the
    // one a Sales Reference is required to leave.
    expect(only("is_default").map((s) => s.code)).toEqual(["LEAD"])
  })

  it("carries the badge theme each stage already rendered with", () => {
    const theme = (code) => PIPELINE_STAGE_SEED.find((s) => s.code === code).theme
    expect(theme("LEAD")).toBe("mauve")
    expect(theme("NEGOTIATION")).toBe("violet")
    expect(theme("CLOSED_WON")).toBe("green")
    expect(theme("CLOSED_LOST")).toBe("red")
  })
})

describe("deriving realized stages from stage order", () => {
  it("reproduces the policy Realized set exactly from the seed", () => {
    // The regression that makes the whole refactor safe: derivation must not
    // move a single deal between the Realized and Projected Commission Pool.
    expect(realizedStageCodes(PIPELINE_STAGE_SEED)).toEqual(REALIZED_STAGES)
  })

  it("finds the Anchor Stage that stamps Contract Date", () => {
    expect(anchorStage(PIPELINE_STAGE_SEED).code).toBe("AWARDED")
  })

  it("counts a stage at or after the anchor as realized", () => {
    const at = (code) => PIPELINE_STAGE_SEED.find((s) => s.code === code)
    expect(isRealizedStage(at("AWARDED"), PIPELINE_STAGE_SEED)).toBe(true)
    expect(isRealizedStage(at("COLLECTION"), PIPELINE_STAGE_SEED)).toBe(true)
    expect(isRealizedStage(at("NEGOTIATION"), PIPELINE_STAGE_SEED)).toBe(false)
  })

  it("never counts the lost stage as realized despite it sorting last", () => {
    const lost = PIPELINE_STAGE_SEED.find((s) => s.is_lost)
    expect(lost.sort_order).toBeGreaterThan(anchorStage(PIPELINE_STAGE_SEED).sort_order)
    expect(isRealizedStage(lost, PIPELINE_STAGE_SEED)).toBe(false)
  })

  it("puts a newly added open-region stage in the Projected pool", () => {
    const stages = [
      ...PIPELINE_STAGE_SEED,
      {
        code: "SITE_SURVEY",
        label: "Site Survey",
        sort_order: 45,
        theme: "blue",
        is_active: true,
        is_system: false,
        is_default: false,
        is_anchor: false,
        is_won: false,
        is_lost: false,
      },
    ]
    expect(realizedStageCodes(stages)).toEqual(REALIZED_STAGES)
  })

  it("treats a stage list with no anchor as having nothing realized", () => {
    // A truncated or corrupt stage list must under-report the Realized pool
    // rather than silently promoting pipeline deals into it.
    const anchorless = PIPELINE_STAGE_SEED.map((s) => ({ ...s, is_anchor: false }))
    expect(anchorStage(anchorless)).toBeNull()
    expect(realizedStageCodes(anchorless)).toEqual([])
  })
})

describe("asking about a stage by the code stored on an opportunity", () => {
  it("resolves a stored status to its stage row", () => {
    expect(stageByCode("NEGOTIATION").label).toBe("Negotiation")
  })

  it("returns null for a status no longer in the pipeline rather than throwing", () => {
    // Rows written before a stage was retired still carry its code.
    expect(stageByCode("SOME_RETIRED_STAGE")).toBeNull()
    expect(stageByCode(null)).toBeNull()
  })

  it("answers won, lost and realized without the caller knowing a code", () => {
    expect(isWonCode("CLOSED_WON")).toBe(true)
    expect(isWonCode("AWARDED")).toBe(false)
    expect(isLostCode("CLOSED_LOST")).toBe(true)
    expect(isLostCode("CLOSED_WON")).toBe(false)
    expect(isRealizedCode("PO_RECEIVED")).toBe(true)
    expect(isRealizedCode("QUALIFIED")).toBe(false)
    expect(isRealizedCode("CLOSED_LOST")).toBe(false)
  })

  it("identifies the stage that stamps Contract Date", () => {
    expect(isAnchorCode("AWARDED")).toBe(true)
    expect(isAnchorCode("CLOSED_WON")).toBe(false)
  })

  it("treats an unknown status as neither won, lost nor realized", () => {
    expect(isWonCode("SOME_RETIRED_STAGE")).toBe(false)
    expect(isLostCode("SOME_RETIRED_STAGE")).toBe(false)
    expect(isRealizedCode("SOME_RETIRED_STAGE")).toBe(false)
  })

  it("follows a caller's own stage list rather than the seed", () => {
    // What the register does once it has loaded crm_pipeline_stages.
    const renamed = PIPELINE_STAGE_SEED.map((s) =>
      s.code === "AWARDED" ? { ...s, is_anchor: false } : { ...s, is_anchor: s.code === "NEGOTIATION" },
    )
    expect(isRealizedCode("NEGOTIATION", renamed)).toBe(true)
    expect(isRealizedCode("NEGOTIATION")).toBe(false)
  })
})

describe("stage gating derived from flags rather than codes", () => {
  it("still gates leaving the default stage on a Sales Reference", () => {
    expect(requiresSalesReference("LEAD", "QUALIFIED")).toBe(true)
    expect(requiresSalesReference("LEAD", "CLOSED_LOST")).toBe(false)
    expect(requiresSalesReference("QUALIFIED", "AWARDED")).toBe(false)
  })

  it("follows the default flag when a different stage is the entry point", () => {
    const stages = PIPELINE_STAGE_SEED.map((s) => ({
      ...s,
      is_default: s.code === "QUALIFIED",
    }))
    expect(requiresSalesReference("QUALIFIED", "NEGOTIATION", stages)).toBe(true)
    expect(requiresSalesReference("LEAD", "QUALIFIED", stages)).toBe(false)
  })
})

/**
 * The ITB (Invitation to Bid) Number gate was added on top of the flag-driven
 * design: it must key off the same is_itb_gate flag pattern as the anchor,
 * never off a stage's sort_order literal or code — a magic number baked into
 * a threshold comparison is exactly what the flag design exists to prevent,
 * because reordering or renaming the gate stage would silently detach it.
 *
 * The gate asks two separate questions, and they are separate functions here
 * for a reason: requiresItbNumber() is about the *move* (does the gate stand
 * between these two stages), itbGateSatisfiedBy() is about the *record* (does
 * this deal have what the gate asks for). Collapsing them is how the outright
 * exemption ends up honoured at two call sites out of three.
 */
describe("the ITB Number gate", () => {
  it("names For Bidding as the single stage requiring an ITB Number", () => {
    expect(itbGateStage(PIPELINE_STAGE_SEED).code).toBe("FOR_BIDDING")
  })

  it("requires an ITB Number moving from before the gate to it or beyond", () => {
    expect(requiresItbNumber("PROPOSAL_SUBMITTED", "FOR_BIDDING")).toBe(true)
    expect(requiresItbNumber("QUALIFIED", "NEGOTIATION")).toBe(true)
    expect(requiresItbNumber("PROPOSAL_SUBMITTED", "AWARDED")).toBe(true)
  })

  it("gates the jump straight to Closed Won, not only the pre-award stages", () => {
    // The move sales actually makes on an outright deal. It crosses the gate
    // like any other, which is why the exemption below has to exist.
    expect(requiresItbNumber("QUALIFIED", "CLOSED_WON")).toBe(true)
  })

  it("does not gate a move that stays before the gate stage", () => {
    expect(requiresItbNumber("PROPOSAL_SUBMITTED", "QUALIFIED")).toBe(false)
  })

  it("does not re-gate a move that stays at or past the gate stage", () => {
    // Already-quoted opportunities keep advancing without a second ask.
    expect(requiresItbNumber("FOR_BIDDING", "BID_SUBMITTED")).toBe(false)
    expect(requiresItbNumber("NEGOTIATION", "AWARDED")).toBe(false)
  })

  it("lets a deal be closed as lost before it was ever put out to bid", () => {
    expect(requiresItbNumber("QUALIFIED", "CLOSED_LOST")).toBe(false)
  })

  it("keeps gating at the position the gate stage actually holds after a reorder", () => {
    // The whole point of deriving from a flag: moving For Bidding's sort_order
    // must move the gate with it, not leave a stale threshold behind.
    const reordered = PIPELINE_STAGE_SEED.map((s) => {
      if (s.code === "FOR_BIDDING") return { ...s, sort_order: 25 }
      if (s.code === "QUALIFIED") return { ...s, sort_order: 35 }
      return s
    })

    // A move that used to be gated (Qualified was past For Bidding) no longer is.
    expect(requiresItbNumber("PROPOSAL_SUBMITTED", "QUALIFIED", reordered)).toBe(true)
    expect(requiresItbNumber("PROPOSAL_SUBMITTED", "FOR_BIDDING", reordered)).toBe(true)
  })

  it("never gates anything when no stage carries the flag", () => {
    const noGate = PIPELINE_STAGE_SEED.map((s) => ({ ...s, is_itb_gate: false }))
    expect(itbGateStage(noGate)).toBeNull()
    expect(requiresItbNumber("LEAD", "CLOSED_WON", noGate)).toBe(false)
  })
})

/**
 * The exemption is what makes the gate survivable. Between 0035 and 0038 there
 * was no way for a deal to say "no Invitation to Bid was ever issued for me",
 * so outright awards — government direct contracts among them — could only be
 * blocked or have the gate turned off for everybody. It was turned off for
 * everybody (0037). This is the answer that replaced that.
 */
describe("what satisfies the ITB gate", () => {
  it("takes an ITB Number on record", () => {
    expect(itbGateSatisfiedBy({ itb_number: "ITB-2026-001" })).toBe(true)
  })

  it("takes an outright marking in place of a number", () => {
    expect(itbGateSatisfiedBy({ itb_number: null, itb_exempt: true })).toBe(true)
  })

  it("is not satisfied by a deal carrying neither", () => {
    expect(itbGateSatisfiedBy({ itb_number: null, itb_exempt: false })).toBe(false)
  })

  it("treats a blank number as no number", () => {
    // The trigger nullifies btrim(itb_number) before checking, so whitespace
    // must not read as satisfied here either.
    expect(itbGateSatisfiedBy({ itb_number: "" })).toBe(false)
  })

  it("answers false rather than throwing for a missing opportunity", () => {
    // Called during render against a row that may not have loaded yet.
    expect(itbGateSatisfiedBy(null)).toBe(false)
    expect(itbGateSatisfiedBy(undefined)).toBe(false)
  })
})

describe("choosing which stages a board or matrix should render", () => {
  it("renders every active stage even with nothing occupying it", () => {
    expect(renderableStages(PIPELINE_STAGE_SEED, []).map((s) => s.code)).toEqual(
      activeStages(PIPELINE_STAGE_SEED).map((s) => s.code),
    )
  })

  it("keeps a deactivated stage visible when an opportunity still sits in it", () => {
    // A super admin deactivating a stage must never make an opportunity in it
    // disappear from the board — only stop it being offered for new work.
    const stages = PIPELINE_STAGE_SEED.map((s) =>
      s.code === "NEGOTIATION" ? { ...s, is_active: false } : s,
    )

    const rendered = renderableStages(stages, ["NEGOTIATION"]).map((s) => s.code)

    expect(rendered).toContain("NEGOTIATION")
  })

  it("drops a deactivated stage nothing occupies", () => {
    const stages = PIPELINE_STAGE_SEED.map((s) =>
      s.code === "NEGOTIATION" ? { ...s, is_active: false } : s,
    )

    const rendered = renderableStages(stages, ["QUALIFIED"]).map((s) => s.code)

    expect(rendered).not.toContain("NEGOTIATION")
  })

  it("keeps the result in pipeline order even when the occupied stage sorts first", () => {
    const stages = PIPELINE_STAGE_SEED.map((s) =>
      s.code === "LEAD" ? { ...s, is_active: false } : s,
    )

    const rendered = renderableStages(stages, ["LEAD"]).map((s) => s.code)

    expect(rendered[0]).toBe("LEAD")
    expect(rendered).toEqual([...rendered].sort((a, b) =>
      stageByCode(a, stages).sort_order - stageByCode(b, stages).sort_order,
    ))
  })

  it("never lists the same stage twice when it is both active and occupied", () => {
    const rendered = renderableStages(PIPELINE_STAGE_SEED, ["NEGOTIATION", "NEGOTIATION"])
    expect(rendered.filter((s) => s.code === "NEGOTIATION")).toHaveLength(1)
  })
})

describe("classifying stages for the register and the admin screen", () => {
  it("treats only won and lost as terminal", () => {
    // What the register's stage filter calls "open" — everything a deal can
    // still move on from, which includes the whole post-award run.
    const terminal = PIPELINE_STAGE_SEED.filter(isTerminalStage).map((s) => s.code)
    expect(terminal).toEqual(["CLOSED_WON", "CLOSED_LOST"])
  })

  it("puts the pre-award stages in the open region a super admin may edit", () => {
    const open = PIPELINE_STAGE_SEED.filter((s) =>
      isOpenRegionStage(s, PIPELINE_STAGE_SEED),
    ).map((s) => s.code)
    expect(open).toEqual([
      "LEAD",
      "PROPOSAL_SUBMITTED",
      "QUALIFIED",
      "FOR_BIDDING",
      "BID_SUBMITTED",
      "NEGOTIATION",
    ])
  })

  it("keeps the anchor itself and everything after it out of the open region", () => {
    const at = (code) => PIPELINE_STAGE_SEED.find((s) => s.code === code)
    expect(isOpenRegionStage(at("AWARDED"), PIPELINE_STAGE_SEED)).toBe(false)
    expect(isOpenRegionStage(at("RETENTION"), PIPELINE_STAGE_SEED)).toBe(false)
    expect(isOpenRegionStage(at("CLOSED_LOST"), PIPELINE_STAGE_SEED)).toBe(false)
  })
})
