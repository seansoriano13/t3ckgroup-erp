import { beforeEach, describe, expect, it } from "vitest";
import { opportunityService } from "./opportunityService";
import { db } from "@/test/db/store";
import {
  makeEmployee,
  makeFlowSnapshot,
  makeFlowStage,
  makeOpportunity,
  makeSaleType,
  makeSalesFlow,
  makeStageAction,
} from "@/test/factories";
import { stubActionRunRpcs } from "@/test/stubs/actionRunRpc";
import { stubMoveOpportunitiesToSnapshotRpc } from "@/test/stubs/moveOpportunitiesToSnapshotRpc";

/**
 * #846 / #882: updating an SOR to a newer Flow Snapshot runs the Stage Actions
 * that version added to the SOR's current Stage. The planning read used to
 * select `sales_opportunities.sale_type`, a column that does not exist, so the
 * new Actions silently never ran. The fake PostgREST validates column names,
 * so these tests fail on that query.
 */
describe("updating SORs to a newer version (#846, #882)", () => {
  let owner;
  let flow;
  let stage;
  let v1;
  let v2;
  let sor;
  let action;

  beforeEach(() => {
    stubActionRunRpcs();
    stubMoveOpportunitiesToSnapshotRpc();
    const saleType = makeSaleType({ name: "Government" });
    flow = makeSalesFlow({ sale_type_id: saleType.id });
    stage = makeFlowStage({ flow_id: flow.id });
    v1 = makeFlowSnapshot({ flow_id: flow.id });
    action = makeStageAction({
      stage_id: stage.id,
      kind: "create_individual_task",
      config: { title: "Site survey" },
    });
    v2 = makeFlowSnapshot({ flow_id: flow.id });
    owner = makeEmployee({ name: "Ben Cruz" });
    sor = makeOpportunity({
      sale_type_id: saleType.id,
      flow_stage_id: stage.id,
      flow_snapshot_id: v1.id,
      deal_owner_id: owner.id,
      sales_reference: "S0001",
      project_title: "Fire truck supply",
    });
  });

  it("previews the Stage Action the newer version adds to the SOR's Stage", async () => {
    const preview = await opportunityService.previewVersionUpdate([sor.id], v2.id);

    expect(preview.lines).toHaveLength(1);
    expect(preview.lines[0].text).toMatch(/Site survey/);
  });

  it("runs the added Stage Action for the updated SOR and reports no planning error", async () => {
    const result = await opportunityService.updateSorVersions([sor.id], v2.id, { actorId: owner.id });

    expect(result.planError).toBeNull();
    expect(result.succeeded.map((m) => m.id)).toEqual([sor.id]);
    expect(result.actionFailures).toEqual([]);
    const runs = db.internal.rowsOf("sor_action_runs").filter((r) => r.opportunity_id === sor.id);
    expect(runs.map((r) => r.action_id)).toEqual([action.id]);
  });
});
