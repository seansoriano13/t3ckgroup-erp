import { describe, it, expect } from "vitest";
import { QUEUE_EXPORT_HEADER, queueExportRows } from "./queueList";

describe("the Purchase Requests export (#683)", () => {
  it("leads with the request's PR number", () => {
    const row = { opportunity_id: null, title: "Toner", pr_number: "PR_0042", item_count: 0, open_count: 0, created_at: "2026-10-01T00:00:00Z" };
    expect(QUEUE_EXPORT_HEADER[0]).toBe("PR number");
    expect(queueExportRows([row])[0][0]).toBe("PR_0042");
  });
});
