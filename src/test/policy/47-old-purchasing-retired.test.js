/**
 * Retiring the old purchasing surfaces (#314, part of #209): no path raises a
 * purchasing task any more, and the old Canvass/Inclusion rows are kept.
 */
import { describe, it, expect, beforeAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"

beforeAll(ensureCastLoaded)

describe("old purchasing", () => {
    it("sor_raise_procurement_task no longer exists", async () => {
        const { error } = await (await clientFor("dealOwner")).rpc("sor_raise_procurement_task", {
            p_opportunity_id: ids.dealOwner,
            p_assignee_id: ids.dealOwner,
            p_description: "x",
            p_checklist: [],
            p_project_title: "x",
            p_category_id: "x",
            p_reported_to: ids.dealOwner,
            p_remarks: "x",
        })
        expect(error?.code).toBe("PGRST202")
    })
})
