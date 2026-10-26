import { beforeEach, describe, expect, it } from "vitest";
import { CostingRuleError, costingMatrixService, signoffState, toRuleError } from "./costingMatrixService";
import { costingEvaluationSettingsService } from "./costingEvaluationSettingsService";
import { db } from "@/test/db/store";
import { makeEmployee, makeOpportunity } from "@/test/factories";
import { stubCostingMatrixRpcs } from "@/test/stubs/costingMatrixRpc";
import { COSTING_TIER } from "@/constants/costing";
import { describeComplianceRollup } from "@/utils/costingMath";

/**
 * The Evaluation of Specification through the service (#271): the verdicts, their roll-ups, the
 * "Evaluation approved" sign-off and what clears it, against the fake database with the matrix
 * functions re-implemented on its store (stubCostingMatrixRpcs) and the clearing triggers
 * mirrored in src/test/db/triggers.js. Who may write a verdict, and the real triggers, are the
 * policy tier's (82-costing-evaluation.test.js).
 */
describe("the Evaluation of Specification", () => {
  let reviewer;
  let opportunity;
  let matrix;
  let lineId;
  let compA;
  let compB;
  let compC;

  const read = () => costingMatrixService.get(opportunity.id);
  const evaluate = async (id, verdict, note) => costingMatrixService.setCompliance(id, { verdict, note });
  const stored = (id) => db.rows("costing_components").find((c) => c.id === id);

  beforeEach(async () => {
    reviewer = makeEmployee({ name: "Purchasing Reviewer", department: "PURCHASING" });
    opportunity = makeOpportunity({ registered_by: reviewer.id, deal_owner_id: reviewer.id });
    matrix = db.seed("costing_matrices", { opportunity_id: opportunity.id });
    stubCostingMatrixRpcs({ tier: COSTING_TIER.CLOSED_BOOK, bands: ["sales", "purchasing", "technical"], actorId: reviewer.id });

    lineId = await costingMatrixService.addTenderLine(matrix.id, { tenderSpecification: "Rescue tripod, 3 m, 22 kN", quantity: 2, abcUnit: 20000, finalOfferUnit: 18000 });
    compA = await costingMatrixService.addComponent(lineId, { name: "Tripod", offerSpecification: "Tripod 3 m, 22 kN", acquireUnit: 9000 });
    compB = await costingMatrixService.addComponent(lineId, { name: "Head", offerSpecification: "Head, 2.5 m", acquireUnit: 2000 });
    compC = await costingMatrixService.addComponent(lineId, { name: "Bag", offerSpecification: "Carry bag" });
  });

  describe("verdicts", () => {
    it("records a verdict, its note and the recommended alternative", async () => {
      await costingMatrixService.setCompliance(compA, { verdict: "complies" });
      await costingMatrixService.setCompliance(compB, { verdict: "deviates", note: "2.5 m, not 3 m", alternative: "Head 3 m (model T3)" });

      const { tenderLines } = await read();
      expect(tenderLines[0].components[0]).toMatchObject({ compliance: "complies", compliance_note: null, recommended_alternative: null });
      expect(tenderLines[0].components[1]).toMatchObject({
        compliance: "deviates",
        compliance_note: "2.5 m, not 3 m",
        recommended_alternative: "Head 3 m (model T3)",
      });
      expect(tenderLines[0].components[2].compliance).toBeNull();
    });

    it("leaves a field alone when it is not passed, and clears one set to blank", async () => {
      await costingMatrixService.setCompliance(compB, { verdict: "deviates", note: "Short", alternative: "Longer one" });
      await costingMatrixService.setCompliance(compB, { alternative: "" });
      expect(stored(compB)).toMatchObject({ compliance: "deviates", compliance_note: "Short", recommended_alternative: null });
      await costingMatrixService.setCompliance(compB, { verdict: null });
      expect(stored(compB)).toMatchObject({ compliance: null, compliance_note: "Short" });
    });

    it("refuses a deviation without a note, passed blank or never written", async () => {
      const blank = await costingMatrixService.setCompliance(compA, { verdict: "deviates", note: "  " }).catch((e) => e);
      expect(blank).toBeInstanceOf(CostingRuleError);
      expect(blank.message).toBe("A deviation needs a note.");

      // No note passed and none on the row: the database's CHECK refuses it.
      const bare = await costingMatrixService.setCompliance(compA, { verdict: "deviates" }).catch((e) => e);
      expect(bare).toBeInstanceOf(CostingRuleError);
      expect(bare.message).toBe("A deviation needs a note.");
      expect(stored(compA).compliance).toBeNull();

      // With a note already on the row, the verdict alone is enough.
      await costingMatrixService.setCompliance(compA, { note: "Was fine" });
      await costingMatrixService.setCompliance(compA, { verdict: "deviates" });
      expect(stored(compA).compliance).toBe("deviates");
    });

    it("refuses a verdict that is neither Complies nor Deviates", async () => {
      const odd = await costingMatrixService.setCompliance(compA, { verdict: "maybe" }).catch((e) => e);
      expect(odd).toBeInstanceOf(CostingRuleError);
      expect(stored(compA).compliance).toBeNull();
    });

    it("reads the database's own refusal of a missing note in words", () => {
      const message = 'new row for relation "costing_components" violates check constraint "costing_components_deviation_note_chk"';
      expect(toRuleError({ code: "23514", message }).message).toBe("A deviation needs a note.");
    });
  });

  describe("roll-ups", () => {
    it("counts what deviates and what is not evaluated, per Tender Line and for the whole matrix", async () => {
      const second = await costingMatrixService.addTenderLine(matrix.id, { tenderSpecification: "Harness", quantity: 1 });
      const compD = await costingMatrixService.addComponent(second, { name: "Harness" });
      await evaluate(compA, "complies");
      await evaluate(compB, "deviates", "Short");
      await evaluate(compD, "deviates", "Wrong size");

      const result = await read();
      expect(result.tenderLines[0].compliance).toEqual({ deviates: 1, notEvaluated: 1, total: 3 });
      expect(result.tenderLines[1].compliance).toEqual({ deviates: 1, notEvaluated: 0, total: 1 });
      expect(result.compliance).toEqual({ deviates: 2, notEvaluated: 1, total: 4 });
      expect(describeComplianceRollup(result.compliance)).toBe("2 of 4 deviate · 1 not evaluated");
    });

    it("serves the verdicts to a Stage Participant, who reads no money", async () => {
      await evaluate(compB, "deviates", "Short");
      stubCostingMatrixRpcs({ tier: COSTING_TIER.PARTICIPANT, bands: ["technical"] });
      const result = await read();
      expect(result.tenderLines[0].components[1]).toMatchObject({ compliance: "deviates", compliance_note: "Short" });
      expect(result.compliance).toEqual({ deviates: 1, notEvaluated: 2, total: 3 });
      expect(JSON.stringify(result)).not.toMatch(/acquire_unit|final_offer_unit|abc_unit|odoo_unit|markup_factor/);
    });

    it("leaves every figure unchanged by a deviation", async () => {
      const figures = (matrixRead) => ({
        totals: matrixRead.totals,
        lines: matrixRead.tenderLines.map((l) => ({ totals: l.totals, components: l.components.map((c) => c.totals) })),
        costRows: matrixRead.costRowsTotals,
      });
      const before = figures(await read());
      expect(before.lines[0].totals).toMatchObject({ finalOfferTotal: 36000, abcTotal: 40000 });

      await evaluate(compA, "deviates", "Not the same");
      await evaluate(compB, "deviates", "Not the same either");
      expect(figures(await read())).toEqual(before);
    });
  });

  describe("Evaluation approved", () => {
    it("starts unapproved", async () => {
      expect((await read()).evaluation).toEqual({ approved: false, signoff: null, cleared: null });
    });

    it("is refused while a Component has no verdict, and says how many", async () => {
      await evaluate(compA, "complies");
      const refused = await costingMatrixService.sign(matrix.id, "evaluation_approved").catch((e) => e);
      expect(refused.message).toBe("costing_sign: 2 Components have no verdict yet");
      expect(db.rows("costing_signoffs")).toEqual([]);
    });

    it("is signed once every Component has a verdict, a deviation included", async () => {
      await evaluate(compA, "complies");
      await evaluate(compB, "deviates", "Short");
      await evaluate(compC, "complies");

      const signoff = await costingMatrixService.sign(matrix.id, "evaluation_approved");
      expect(signoff).toMatchObject({ role: "evaluation_approved", signed_by: reviewer.id, cleared_at: null });

      const { evaluation } = await read();
      expect(evaluation.approved).toBe(true);
      expect(evaluation.signoff).toMatchObject({ signed_by: reviewer.id });
      expect(evaluation.cleared).toBeNull();
    });

    it("cannot be signed twice, by anyone off the list, or for another role's sign-off", async () => {
      for (const id of [compA, compB, compC]) await evaluate(id, "complies");
      await costingMatrixService.sign(matrix.id);
      expect((await costingMatrixService.sign(matrix.id).catch((e) => e)).message).toMatch(/already approved/);

      stubCostingMatrixRpcs({ tier: COSTING_TIER.CLOSED_BOOK, bands: ["technical"], actorId: reviewer.id, onEvaluationList: false });
      expect((await costingMatrixService.sign(matrix.id).catch((e) => e)).message).toMatch(/evaluation list/);

      // #274: the other roles belong to the incharges and the Final Acquire list (or a Closed Book reader), none of which
      // the reviewer is.
      stubCostingMatrixRpcs({ tier: COSTING_TIER.PRICE, bands: [], actorId: reviewer.id, onFinalAcquireList: false });
      for (const role of ["prepared", "costed", "final_approved"]) {
        expect((await costingMatrixService.sign(matrix.id, role).catch((e) => e)).message, role).toMatch(/only/);
      }
    });
  });

  describe("what clears it", () => {
    const approve = async () => {
      for (const component of db.rows("costing_components")) {
        if (!component.compliance) await costingMatrixService.setCompliance(component.id, { verdict: "complies" });
      }
      await costingMatrixService.sign(matrix.id);
      expect((await read()).evaluation.approved).toBe(true);
    };

    it("clears when an Offer Specification changes, and the history records the reason", async () => {
      await approve();
      await costingMatrixService.updateComponent(compA, { offerSpecification: "Tripod 3 m, 25 kN" });

      const { evaluation } = await read();
      expect(evaluation.approved).toBe(false);
      expect(evaluation.cleared).toMatchObject({ role: "evaluation_approved", signed_by: reviewer.id, cleared_reason: "An Offer Specification changed" });
      expect(evaluation.cleared.cleared_at).toBeTruthy();

      const history = await costingMatrixService.history(opportunity.id, { table: "costing_signoffs" });
      const reason = history.find((event) => event.detail.column === "cleared_reason");
      expect(reason).toMatchObject({ kind: "changed", detail: { row: evaluation.cleared.id, new: "An Offer Specification changed" } });
    });

    const clears = [
      ["a Tender Specification changes", () => costingMatrixService.updateTenderLine(lineId, { tenderSpecification: "Rescue tripod, 3 m, 25 kN" }), "A Tender Specification changed"],
      ["a verdict changes", () => costingMatrixService.setCompliance(compA, { verdict: "deviates", note: "Over spec" }), "A Compliance verdict changed"],
      [
        "a note changes",
        async () => {
          await costingMatrixService.setCompliance(compA, { verdict: "deviates", note: "Over spec" });
          await approve();
          await costingMatrixService.setCompliance(compA, { note: "Over spec by 3 kN" });
        },
        "A Compliance note changed",
      ],
      ["a Component is added", () => costingMatrixService.addComponent(lineId, { name: "Extra" }), "A Component was added"],
      ["a Component is removed", () => costingMatrixService.removeComponent(compC), "A Component was removed"],
      ["a Tender Line is added", () => costingMatrixService.addTenderLine(matrix.id, { tenderSpecification: "Harness" }), "A Tender Line was added"],
      [
        "a Tender Line is removed",
        async () => {
          const extra = await costingMatrixService.addTenderLine(matrix.id, { tenderSpecification: "Harness" });
          await approve();
          await costingMatrixService.removeTenderLine(extra);
        },
        "A Tender Line was removed",
      ],
    ];

    for (const [title, change, reason] of clears) {
      it(`clears when ${title}`, async () => {
        await approve();
        await change();
        const { evaluation } = await read();
        expect(evaluation.approved).toBe(false);
        expect(evaluation.cleared.cleared_reason).toBe(reason);
      });
    }

    it("stays when the recommended alternative, a quantity or a price changes", async () => {
      await approve();
      await costingMatrixService.setCompliance(compA, { alternative: "Another model" });
      await costingMatrixService.updateComponent(compA, { quantity: 3, brand: "Petzl", acquireUnit: 9500 });
      await costingMatrixService.updateTenderLine(lineId, { quantity: 4, finalOfferUnit: 17000 });
      // Writing a verdict it already has changes nothing.
      await costingMatrixService.setCompliance(compA, { verdict: "complies" });
      expect((await read()).evaluation.approved).toBe(true);
    });

    it("can be approved again after it is cleared, and the old sign-off stays as history", async () => {
      await approve();
      await costingMatrixService.updateComponent(compA, { offerSpecification: "Different" });
      await costingMatrixService.sign(matrix.id);

      const rows = db.rows("costing_signoffs");
      expect(rows).toHaveLength(2);
      expect(rows.filter((r) => !r.cleared_at)).toHaveLength(1);
      expect((await read()).evaluation.approved).toBe(true);
    });
  });

  describe("signoffState", () => {
    it("picks the live row, else the newest cleared one", () => {
      const rows = [
        { id: "a", role: "evaluation_approved", cleared_at: "2026-10-16T01:00:00Z", cleared_reason: "old" },
        { id: "b", role: "evaluation_approved", cleared_at: "2026-10-16T02:00:00Z", cleared_reason: "newer" },
        { id: "c", role: "costed", cleared_at: null },
      ];
      expect(signoffState(rows, "evaluation_approved")).toMatchObject({ approved: false, signoff: null, cleared: { id: "b" } });
      expect(signoffState([...rows, { id: "d", role: "evaluation_approved", cleared_at: null }], "evaluation_approved")).toMatchObject({
        approved: true,
        signoff: { id: "d" },
        cleared: null,
      });
      expect(signoffState(undefined, "evaluation_approved")).toEqual({ approved: false, signoff: null, cleared: null });
    });
  });
});

describe("the evaluation settings", () => {
  it("names the template and keeps the evaluation list to exactly the people picked", async () => {
    const boss = makeEmployee({ name: "Reviewer One", department: "PURCHASING" });
    const other = makeEmployee({ name: "Reviewer Two", department: "PURCHASING" });
    const third = makeEmployee({ name: "Reviewer Three", department: "PURCHASING" });
    const template = db.seed("group_task_templates", { name: "Evaluation of Specification", created_by: boss.id });
    db.seed("costing_evaluation_settings", { id: true });
    expect(await costingEvaluationSettingsService.getTemplateId()).toBeNull();
    expect((await costingEvaluationSettingsService.getTemplates()).map((t) => t.name)).toEqual(["Evaluation of Specification"]);

    await costingEvaluationSettingsService.setTemplateId(template.id);
    expect(await costingEvaluationSettingsService.getTemplateId()).toBe(template.id);
    await costingEvaluationSettingsService.setTemplateId(null);
    expect(await costingEvaluationSettingsService.getTemplateId()).toBeNull();

    await costingEvaluationSettingsService.setSigners([boss.id, other.id]);
    expect((await costingEvaluationSettingsService.getSigners()).sort()).toEqual([boss.id, other.id].sort());
    await costingEvaluationSettingsService.setSigners([other.id, third.id]);
    expect((await costingEvaluationSettingsService.getSigners()).sort()).toEqual([other.id, third.id].sort());
    // Only the evaluation key changes.
    db.seed("costing_signer_lists", { list_key: "final_acquire", employee_id: boss.id });
    await costingEvaluationSettingsService.setSigners([]);
    expect(await costingEvaluationSettingsService.getSigners()).toEqual([]);
    expect(db.rows("costing_signer_lists")).toHaveLength(1);
  });
});
