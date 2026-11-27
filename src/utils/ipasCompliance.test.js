import { describe, expect, it } from "vitest";

import { complianceView, complianceViewOfIpas, complianceViewOfSummary, complianceWarning, doneHover } from "./ipasCompliance";

describe("complianceView", () => {
  it("is nothing on an IPAS that does not ask", () => {
    expect(complianceView({ asked: false, needed: null, kinds: [] })).toBeNull();
    expect(complianceViewOfSummary(null)).toBeNull();
    expect(complianceViewOfIpas({ compliance_asked: false })).toBeNull();
  });

  it("reads Not answered yet, None needed, and the kinds with open or done", () => {
    expect(complianceView({ asked: true, needed: null, kinds: [] }).state).toBe("unanswered");
    expect(complianceView({ asked: true, needed: false, kinds: [] }).state).toBe("none");
    const view = complianceView({
      asked: true,
      needed: true,
      kinds: [
        { id: "a", label: "DENR", doneOn: "2026-11-02", note: "ECC" },
        { id: "b", label: "MARINA", doneOn: null },
      ],
    });
    expect(view.state).toBe("kinds");
    expect(view.open.map((kind) => kind.label)).toEqual(["MARINA"]);
  });

  it("reads an IPAS record in list order", () => {
    const view = complianceViewOfIpas({
      compliance_asked: true,
      compliance_needed: true,
      compliance_requirements: [
        { id: "b", done_on: null, note: null, kind: { label: "MARINA", sort: 20 } },
        { id: "a", done_on: "2026-11-02", note: "ECC", kind: { label: "DENR", sort: 10 } },
      ],
    });
    expect(view.kinds.map((kind) => kind.label)).toEqual(["DENR", "MARINA"]);
  });
});

describe("doneHover", () => {
  it("says the day and the note, or the day alone", () => {
    const kind = { doneOn: "2020-11-02", note: "ECC no. 5" };
    expect(doneHover(kind)).toBe("Done Nov 2, 2020 · ECC no. 5");
    expect(doneHover(kind, { withNote: false })).toBe("Done Nov 2, 2020");
  });
});

describe("complianceWarning", () => {
  it("warns while a kind is open or the question is open, and not otherwise", () => {
    expect(complianceWarning(null)).toBeNull();
    expect(complianceWarning(complianceView({ asked: true, needed: false, kinds: [] }))).toBeNull();
    expect(complianceWarning(complianceView({ asked: true, needed: null, kinds: [] }))).toMatch(/not answered yet/);
    const open = complianceView({ asked: true, needed: true, kinds: [{ id: "b", label: "MARINA", doneOn: null }, { id: "c", label: "FDA", doneOn: null }] });
    expect(complianceWarning(open)).toBe("Compliance Requirements still open: MARINA, FDA.");
    expect(complianceWarning(complianceView({ asked: true, needed: true, kinds: [{ id: "a", label: "DENR", doneOn: "2026-11-02" }] }))).toBeNull();
  });
});
