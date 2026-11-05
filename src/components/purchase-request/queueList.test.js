import { describe, it, expect } from "vitest";
import { QUEUE_EXPORT_HEADER, REQUEST_STATE, queueExportRows, requestStateOf } from "./queueList";

describe("the Purchase Requests export (#683)", () => {
  it("leads with the request's PR number", () => {
    const row = { opportunity_id: null, title: "Toner", pr_number: "PR_0042", item_count: 0, open_count: 0, created_at: "2026-10-01T00:00:00Z" };
    expect(QUEUE_EXPORT_HEADER[0]).toBe("PR number");
    expect(queueExportRows([row])[0][0]).toBe("PR_0042");
  });
});

describe("the State of a Purchase Request (#902)", () => {
  const base = { opportunity_id: "o1", pr_number: "PR_0171", item_count: 3, open_count: 0, created_at: "2026-10-01T00:00:00Z" };

  it("says why a request on a deleted SOR is closed, not a plain Closed", () => {
    expect(requestStateOf({ ...base, sor_closed: "deleted" })).toEqual({ state: REQUEST_STATE.SOR_CLOSED, label: "SOR deleted" });
  });

  it("says SOR lost for a request on a lost SOR", () => {
    expect(requestStateOf({ ...base, sor_closed: "lost" })).toEqual({ state: REQUEST_STATE.SOR_CLOSED, label: "SOR lost" });
  });

  it("keeps plain Closed for a request whose every line is finished", () => {
    expect(requestStateOf({ ...base, sor_closed: null })).toEqual({ state: REQUEST_STATE.CLOSED, label: "Closed" });
  });

  it("is Open while a line is still open", () => {
    expect(requestStateOf({ ...base, open_count: 1, sor_closed: null })).toEqual({ state: REQUEST_STATE.OPEN, label: "Open" });
  });

  it("writes the SOR reason in the export too", () => {
    expect(queueExportRows([{ ...base, sor_closed: "deleted" }])[0][9]).toBe("SOR deleted");
  });
});
