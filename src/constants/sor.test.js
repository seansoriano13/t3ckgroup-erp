import { describe, expect, it } from "vitest"
import {
  activeStages,
  anchorStage,
  formatLeadSource,
  formatPHP,
  isAnchorCode,
  isLostCode,
  isOpenRegionStage,
  isRealizedOpportunity,
  isOpenPipelineOpportunity,
  isStillMovingOpportunity,
  isOnTerminalStage,
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

  it("rejects anything that is not S (or SO) followed by digits", () => {
    expect(isValidSalesReference("01237")).toBe(false)
    expect(isValidSalesReference("S")).toBe(false)
    expect(isValidSalesReference("S01237-A")).toBe(false)
    expect(isValidSalesReference("QS01237")).toBe(false)
  })

  it("normalises an SO prefix (Sales Order) into the expected S prefix", () => {
    expect(normalizeSalesReference("SO01237")).toBe("S01237")
    expect(isValidSalesReference("SO01237")).toBe(true)
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

/**
 * ADR 0006 — Realized is a fact about the deal, not a position in a list. A
 * Sales Flow is a graph, so "at or past the anchor" has no meaning; the
 * question is answered by the Contract Date the Won Stage already stamps and
 * never un-stamps.
 */
describe("realized is having a contract date", () => {
  it("counts a deal that has a contract date", () => {
    expect(isRealizedOpportunity({ status: "AWARDED", contract_date: "2026-03-04" })).toBe(true)
  })

  it("does not count a deal that has never been awarded", () => {
    expect(isRealizedOpportunity({ status: "NEGOTIATION", contract_date: null })).toBe(false)
    expect(isRealizedOpportunity({ status: "NEGOTIATION" })).toBe(false)
  })

  it("dynamically counts a deal on a pre-award stage as open, not realized, if moved backwards", () => {
    // Under the dynamic rule, a deal currently sitting on a pre-award
    // stage (like NEGOTIATION) is in Open Pipeline, not Realized.
    expect(isRealizedOpportunity({ status: "NEGOTIATION", contract_date: "2026-03-04" })).toBe(false)
    expect(isOpenPipelineOpportunity({ status: "NEGOTIATION", contract_date: "2026-03-04" })).toBe(true)
  })

  it("never counts a lost deal, whatever its contract date says", () => {
    // The one guard the positional rule carried that survives: a deal that was
    // awarded and then lost is not booked money.
    expect(isRealizedOpportunity({ status: "CLOSED_LOST", contract_date: "2026-03-04" })).toBe(false)
  })

  it("judges legacy deals by stage anchor position regardless of contract date", () => {
    const stage = "PAYMENT_VERIFICATION"
    expect(isRealizedOpportunity({ status: stage, contract_date: "2026-03-04" })).toBe(true)
    expect(isRealizedOpportunity({ status: stage, contract_date: null })).toBe(true)
  })

  it("treats a missing opportunity as not realized", () => {
    // Under-reporting is the safe direction: the alternative silently promotes
    // pipeline deals into booked money.
    expect(isRealizedOpportunity(null)).toBe(false)
    expect(isRealizedOpportunity(undefined)).toBe(false)
  })

  it("follows a caller's own stage list when deciding what lost means", () => {
    const renamed = PIPELINE_STAGE_SEED.map((s) => ({ ...s, is_lost: s.code === "AWARDED" }))
    const deal = { status: "AWARDED", contract_date: "2026-03-04" }
    expect(isRealizedOpportunity(deal, renamed)).toBe(false)
    expect(isRealizedOpportunity(deal)).toBe(true)
  })

  it("still finds the Stage that stamps Contract Date", () => {
    // The anchor keeps its stamping job; it just no longer answers the
    // Realized question by position.
    expect(anchorStage(PIPELINE_STAGE_SEED).code).toBe("AWARDED")
  })

  // Issue #36/#83 — a flow-built deal (it carries a sale_type_id) has no
  // crm_pipeline_stages code, so `status` never answers "is this lost" for
  // it. The caller has to embed the deal's OWN Flow Snapshot instead of the
  // live flow — a later change to the live Won Stage must not retroactively
  // alter which SORs are Realized.
  describe("for a deal that runs a Sales Flow", () => {
    const wonThenLost = {
      sale_type_id: "st-1",
      status: "LEAD", // stale — a flow deal's status never changes
      contract_date: "2026-03-04",
      flow_stage_id: "s-lost",
      flow_snapshot: {
        snapshot_data: {
          wonStageId: "s-won",
          stages: [{ id: "s-lost", is_terminal: true }],
        },
      },
    }

    it("never counts a deal that reached a terminal Stage other than Won", () => {
      expect(isRealizedOpportunity(wonThenLost)).toBe(false)
    })

    it("counts a deal sitting on its flow's Won Stage", () => {
      const won = {
        ...wonThenLost,
        flow_stage_id: "s-won",
        flow_snapshot: {
          snapshot_data: { wonStageId: "s-won", stages: [{ id: "s-won", is_terminal: true }] },
        },
      }
      expect(isRealizedOpportunity(won)).toBe(true)
    })

    it("counts a deal on a Terminal Stage that ends as won (Closed Won)", () => {
      const closedWon = {
        ...wonThenLost,
        flow_stage_id: "s-closed",
        flow_snapshot: {
          snapshot_data: {
            wonStageId: "s-won",
            stages: [
              { id: "s-won", is_terminal: false },
              { id: "s-closed", is_terminal: true, terminal_outcome: "won" },
            ],
            edges: [{ from_stage_id: "s-won", to_stage_id: "s-closed" }],
          },
        },
      }
      expect(isRealizedOpportunity(closedWon)).toBe(true)
    })

    it("counts a deal on a post-won Stage downstream of Won", () => {
      const postWon = {
        ...wonThenLost,
        flow_stage_id: "s-post",
        flow_snapshot: {
          snapshot_data: {
            wonStageId: "s-won",
            stages: [
              { id: "s-won", is_terminal: false },
              { id: "s-post", is_terminal: false },
            ],
            edges: [{ from_stage_id: "s-won", to_stage_id: "s-post" }],
          },
        },
      }
      expect(isRealizedOpportunity(postWon)).toBe(true)
    })

    it("does not count it when the flow_snapshot embed is missing", () => {
      // Under-reporting is the safe direction: a caller that forgot to embed
      // flow_snapshot must not silently overcount a lost deal as booked money.
      expect(isRealizedOpportunity({ ...wonThenLost, flow_snapshot: undefined })).toBe(false)
    })

    it("does not count it when its own Stage no longer appears in its snapshot", () => {
      // A stranded reference (a Stage id the snapshot never captured) is
      // treated the same as a missing embed, not trusted.
      expect(
        isRealizedOpportunity({
          ...wonThenLost,
          flow_snapshot: { snapshot_data: { wonStageId: "s-won", stages: [] } },
        }),
      ).toBe(false)
    })

    it("stays Realized after the live Won Stage is moved on a later snapshot", () => {
      // The whole point of issue #83: this deal's own snapshot still says it
      // won, regardless of what the live flow's Won Stage is today.
      const stillWon = {
        ...wonThenLost,
        flow_stage_id: "s-won",
        flow_snapshot: {
          snapshot_data: { wonStageId: "s-won", stages: [{ id: "s-won", is_terminal: true }] },
        },
      }
      expect(isRealizedOpportunity(stillWon)).toBe(true)
    })

    // Issue #206 — a caller judging many flow SORs at once (the register's
    // Won total, the Board's per-column totals) passes a bulk snapshot index
    // instead of relying on each row embedding its own.
    it("resolves the snapshot from a snapshotsById context, even with no embed", () => {
      const won = { ...wonThenLost, flow_snapshot: undefined, flow_stage_id: "s-won" }
      expect(isRealizedOpportunity(won, { snapshotsById: {} })).toBe(false)

      const withId = { ...won, flow_snapshot_id: "snap-1" }
      const context = {
        snapshotsById: {
          "snap-1": { snapshot_data: { wonStageId: "s-won", stages: [{ id: "s-won", is_terminal: true }] } },
        },
      }
      expect(isRealizedOpportunity(withId, context)).toBe(true)
    })

    it("prefers snapshotsById over an embedded flow_snapshot when both are given", () => {
      const withId = { ...wonThenLost, flow_snapshot_id: "snap-1", flow_stage_id: "s-won" }
      const context = {
        snapshotsById: {
          "snap-1": { snapshot_data: { wonStageId: "s-won", stages: [{ id: "s-won", is_terminal: true }] } },
        },
      }
      // The embed still says s-lost/terminal, but the context's snapshot wins.
      expect(isRealizedOpportunity(withId, context)).toBe(true)
    })
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

  it("answers won and lost without the caller knowing a code", () => {
    expect(isWonCode("CLOSED_WON")).toBe(true)
    expect(isWonCode("AWARDED")).toBe(false)
    expect(isLostCode("CLOSED_LOST")).toBe(true)
    expect(isLostCode("CLOSED_WON")).toBe(false)
  })

  it("identifies the stage that stamps Contract Date", () => {
    expect(isAnchorCode("AWARDED")).toBe(true)
    expect(isAnchorCode("CLOSED_WON")).toBe(false)
  })

  it("treats an unknown status as neither won nor lost", () => {
    expect(isWonCode("SOME_RETIRED_STAGE")).toBe(false)
    expect(isLostCode("SOME_RETIRED_STAGE")).toBe(false)
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

// Issue #199 — Open Pipeline and "still moving" are two named rules.
describe("open pipeline and still moving", () => {
  const snapshot = {
    id: "snap-1",
    snapshot_data: {
      wonStageId: "won",
      stages: [
        { id: "lead", is_terminal: false },
        { id: "won", is_terminal: false },
        { id: "delivery", is_terminal: false },
        { id: "closed", is_terminal: true },
        { id: "lost", is_terminal: true },
      ],
    },
  }
  const snapshotsById = { "snap-1": snapshot }
  const flowDeal = (overrides) => ({
    sale_type_id: "st-1",
    flow_snapshot_id: "snap-1",
    status: "LEAD",
    contract_date: null,
    ...overrides,
  })

  it("counts a flow SOR with no Contract Date on a non-terminal Stage as open", () => {
    expect(isOpenPipelineOpportunity(flowDeal({ flow_stage_id: "lead" }), { snapshotsById })).toBe(true)
  })

  it("leaves a won flow SOR out of the open pipeline but keeps it moving on a post-award Stage", () => {
    const won = flowDeal({ flow_stage_id: "delivery", contract_date: "2026-03-04" })
    expect(isOpenPipelineOpportunity(won, { snapshotsById })).toBe(false)
    expect(isStillMovingOpportunity(won, { snapshotsById })).toBe(true)
  })

  it("leaves a lost flow SOR out of both, whatever its stale status says", () => {
    const lost = flowDeal({ flow_stage_id: "lost" })
    expect(isOpenPipelineOpportunity(lost, { snapshotsById })).toBe(false)
    expect(isStillMovingOpportunity(lost, { snapshotsById })).toBe(false)
  })

  it("judges a flow SOR against its own snapshot, not an embed from a different flow", () => {
    const other = { "snap-1": { snapshot_data: { stages: [{ id: "lead", is_terminal: true }] } } }
    expect(isOpenPipelineOpportunity(flowDeal({ flow_stage_id: "lead" }), { snapshotsById: other })).toBe(false)
  })

  it("counts an SOR whose snapshot is missing under neither rule", () => {
    const deal = flowDeal({ flow_stage_id: "lead" })
    expect(isOpenPipelineOpportunity(deal, { snapshotsById: {} })).toBe(false)
    expect(isStillMovingOpportunity(deal, { snapshotsById: {} })).toBe(false)
  })

  it("counts an SOR whose Stage is not in its snapshot under neither rule", () => {
    const deal = flowDeal({ flow_stage_id: "gone" })
    expect(isOpenPipelineOpportunity(deal, { snapshotsById })).toBe(false)
    expect(isStillMovingOpportunity(deal, { snapshotsById })).toBe(false)
  })

  it("judges a legacy SOR by its pipeline stage code", () => {
    expect(isOpenPipelineOpportunity({ status: "NEGOTIATION", contract_date: null })).toBe(true)
    expect(isOpenPipelineOpportunity({ status: "NEGOTIATION", contract_date: "2026-03-04" })).toBe(true)
    expect(isStillMovingOpportunity({ status: "NEGOTIATION", contract_date: "2026-03-04" })).toBe(true)
    expect(isStillMovingOpportunity({ status: "CLOSED_WON" })).toBe(false)
    expect(isOpenPipelineOpportunity({ status: "CLOSED_LOST" })).toBe(false)
    expect(isStillMovingOpportunity({ status: "NOT_A_STAGE" })).toBe(false)
  })

  // Issue #206 — the register's default sort sinks a Terminal Stage SOR.
  describe("isOnTerminalStage", () => {
    it("is true for a legacy SOR on a won or lost stage", () => {
      expect(isOnTerminalStage({ status: "CLOSED_WON" })).toBe(true)
      expect(isOnTerminalStage({ status: "CLOSED_LOST" })).toBe(true)
    })

    it("is false for a legacy SOR still moving, even post-award", () => {
      expect(isOnTerminalStage({ status: "NEGOTIATION" })).toBe(false)
      expect(isOnTerminalStage({ status: "RETENTION" })).toBe(false)
    })

    it("is true for a flow SOR whose own snapshot marks its Stage terminal", () => {
      const lost = flowDeal({ flow_stage_id: "lost" })
      expect(isOnTerminalStage(lost, { snapshotsById })).toBe(true)
    })

    it("is false for a flow SOR on a non-terminal Stage, won or not", () => {
      const delivery = flowDeal({ flow_stage_id: "delivery", contract_date: "2026-03-04" })
      expect(isOnTerminalStage(delivery, { snapshotsById })).toBe(false)
    })

    it("is false, not true, when the Stage can't be resolved", () => {
      expect(isOnTerminalStage({ status: "NOT_A_STAGE" })).toBe(false)
      expect(isOnTerminalStage(flowDeal({ flow_stage_id: "gone" }), { snapshotsById })).toBe(false)
    })
  })
})

// Cutover (#414): the backfill attaches every old SOR to Legacy Pipeline, a
// flow with no published version. Those SORs keep being judged by their
// stage code, not dropped from Open / Won.
describe("an SOR on a flow with no version on record", () => {
  const versionless = (status) => ({ status, sale_type_id: "legacy-pipeline", flow_stage_id: "fs-1", flow_snapshot_id: null })

  it("counts toward Open Pipeline before the anchor stage", () => {
    expect(isOpenPipelineOpportunity(versionless("LEAD"))).toBe(true)
    expect(isOpenPipelineOpportunity(versionless("AWARDED"))).toBe(false)
  })

  it("counts as Realized at or past the anchor stage", () => {
    expect(isRealizedOpportunity(versionless("AWARDED"))).toBe(true)
    expect(isRealizedOpportunity(versionless("LEAD"))).toBe(false)
  })

  it("is terminal by its stage code", () => {
    expect(isOnTerminalStage(versionless("CLOSED_WON"))).toBe(true)
    expect(isStillMovingOpportunity(versionless("LEAD"), {})).toBe(true)
  })

  it("an SOR whose version just isn't loaded yet still counts toward neither", () => {
    const pinned = { ...versionless("LEAD"), flow_snapshot_id: "snap-1" }
    expect(isOpenPipelineOpportunity(pinned, { snapshotsById: {} })).toBe(false)
    expect(isRealizedOpportunity(pinned, { snapshotsById: {} })).toBe(false)
  })
})
