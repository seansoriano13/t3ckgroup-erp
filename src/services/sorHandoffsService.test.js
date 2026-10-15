import { beforeEach, describe, expect, it } from "vitest";
import { sorHandoffsService } from "./sorHandoffsService";
import { db } from "@/test/db/store";
import { stubSorHandoffsRpc } from "@/test/stubs/sorHandoffsRpc";
import { makeEmployee, makeOpportunity } from "@/test/factories";
import { transmittalStateLabel } from "@/utils/transmittals";

/**
 * The SOR's Transmittals and Packing Lists (#257, spec #251) through the
 * service, against the fake database with `handoffs_for_sor` re-implemented on
 * its store (stubSorHandoffsRpc). The SOR read rule and the no-remark columns
 * are the policy tier's (73-sor-handoffs). This proves the wiring: the rows the
 * section shows, and that it stays hidden on an SOR with no rows.
 */

/** A slip naming an SOR on one line; `na` is how many of its lines are NA. */
function seedSlip(opportunityId, { number, state = "awaiting_check", lines = 1, na = 0 }) {
  const slip = db.seed("transmittals", {
    number,
    prepared_by: makeEmployee().id,
    origin: "purchasing",
    entity: "T3ck Trading",
    check_warehouse: true,
    check_technical: true,
    prepared_on: "2026-10-15",
    priority: "high",
    state,
  });
  for (let i = 0; i < lines; i += 1) {
    db.seed("transmittal_lines", {
      transmittal_id: slip.id,
      opportunity_id: opportunityId,
      kind: "typed",
      position: i + 1,
      description: "Cutter",
      quantity: 1,
      unit: "Unit",
      wh_rating: i < na ? "na" : "gc",
      tech_rating: null,
    });
  }
  return slip;
}

describe("sorHandoffsService", () => {
  beforeEach(() => {
    stubSorHandoffsRpc({ canReadSor: true, canReadRecord: true });
  });

  it("shows the Transmittals naming the SOR with their stage and NA count, and its Packing Lists", async () => {
    const sor = makeOpportunity();
    const other = makeOpportunity();
    const slip = seedSlip(sor.id, { number: "TG03-901", state: "technical_inspection", lines: 2, na: 1 });
    seedSlip(other.id, { number: "TG03-902" });
    db.seed("packing_lists", {
      number: "PKL_001",
      created_by: makeEmployee().id,
      state: "packed",
      opportunity_id: sor.id,
      odoo_delivery_ref: "TG En/OUT/03390",
    });

    const handoffs = await sorHandoffsService.forSor(sor.id);

    expect(handoffs.transmittals).toEqual([
      expect.objectContaining({
        id: slip.id,
        number: "TG03-901",
        priority: "high",
        state: "technical_inspection",
        stateLabel: transmittalStateLabel("technical_inspection"),
        naCount: 1,
        canOpen: true,
      }),
    ]);
    expect(handoffs.packingLists).toEqual([
      expect.objectContaining({
        number: "PKL_001",
        state: "packed",
        stateLabel: "Packed",
        boxCount: 0,
        odooDeliveryRef: "TG En/OUT/03390",
        canOpen: true,
      }),
    ]);
  });

  it("is hidden, with no rows, on an SOR with no Transmittals or Packing Lists", async () => {
    const sor = makeOpportunity();
    seedSlip(makeOpportunity().id, { number: "TG03-903" });

    const handoffs = await sorHandoffsService.forSor(sor.id);

    expect(handoffs).toEqual({ transmittals: [], packingLists: [] });
  });

  it("returns nothing to someone who cannot read the SOR", async () => {
    const sor = makeOpportunity();
    seedSlip(sor.id, { number: "TG03-904" });
    stubSorHandoffsRpc({ canReadSor: false });

    expect(await sorHandoffsService.forSor(sor.id)).toEqual({ transmittals: [], packingLists: [] });
  });

  it("carries no remark, file or evidence path on any row", async () => {
    const sor = makeOpportunity();
    seedSlip(sor.id, { number: "TG03-905", na: 1 });
    db.seed("packing_lists", { number: "PKL_002", state: "draft", opportunity_id: sor.id, created_by: makeEmployee().id });

    const handoffs = await sorHandoffsService.forSor(sor.id);
    const rows = [...handoffs.transmittals, ...handoffs.packingLists];

    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(Object.keys(row).join(" ")).not.toMatch(/remark|file|evidence|storage/i);
    }
  });

  it("asks for nothing when there is no SOR", async () => {
    expect(await sorHandoffsService.forSor(null)).toEqual({ transmittals: [], packingLists: [] });
  });
});
