import { describe, it, expect, beforeEach } from "vitest";
import { stageActionService } from "./stageActionService";
import { makeEmployee, makeSaleType, makeSalesFlow, makeFlowStage, db } from "../test/factories";
import { waitForNetworkIdle } from "../test/network";

describe("stageActionService", () => {
  let admin, regular, saleType, flow, stage;

  beforeEach(async () => {
    admin = makeEmployee({ is_super_admin: true });
    regular = makeEmployee({ is_super_admin: false });
    saleType = makeSaleType();
    flow = makeSalesFlow({ sale_type_id: saleType.id, state: "draft" });
    stage = makeFlowStage({ flow_id: flow.id });
  });

  describe("add", () => {
    // Access control is deliberately off while Flow Canvas is a
    // collaborative build surface (see requireSuperAdmin's comment) — this
    // test is retired, not deleted, so it's easy to find when the gate
    // comes back once flows are locked into the production pipeline.
    it.skip("refuses for a non-Super-Admin", async () => {
      await expect(
        stageActionService.add(
          { stageId: stage.id, kind: "create_group_task", config: { title: "Test" } },
          regular.id,
        ),
      ).rejects.toThrow(/Only a Super Admin/);
    });

    it("adds a valid action", async () => {
      const added = await stageActionService.add(
        { stageId: stage.id, kind: "create_group_task", config: { title: "Test Action" } },
        admin.id,
      );

      expect(added.kind).toBe("create_group_task");
      expect(added.config.title).toBe("Test Action");
      expect(added.sort_order).toBe(0);

      const all = await stageActionService.getForStage(stage.id);
      expect(all).toHaveLength(1);
    });
  });

  describe("archive", () => {
    it("soft-archives an action", async () => {
      const action = await stageActionService.add(
        { stageId: stage.id, kind: "create_group_task", config: { title: "To be archived" } },
        admin.id,
      );

      await stageActionService.archive(action.id, admin.id);

      const allActive = await stageActionService.getForStage(stage.id);
      expect(allActive).toHaveLength(0);

      const allIncludingArchived = await stageActionService.getForStage(stage.id, { includeArchived: true });
      expect(allIncludingArchived).toHaveLength(1);
      expect(allIncludingArchived[0].archived_at).not.toBeNull();
    });
  });
});
