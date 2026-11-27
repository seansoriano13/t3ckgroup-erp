import { describe, expect, it } from "vitest";

import { complianceFor, complianceView, complianceViewOfIpas, complianceWarning } from "./ipasCompliance";

describe("complianceView", () => {
  it("is nothing on an IPAS that does not ask", () => {
    expect(complianceView({ asked: false, needed: null, kinds: [] })).toBeNull();
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

describe("complianceFor: the Compliance Requirement block of section 5", () => {
  const kind = (id, label, sort, doneOn = null) => ({ id: `r-${id}`, kind_id: id, done_on: doneOn, note: null, kind: { id, label, sort } });
  const ctx = (ipas, can = true) => ({
    can: { compliance: can },
    ipas: { state: "open", compliance_asked: true, compliance_needed: null, compliance_requirements: [], ...ipas },
  });

  it("asks the question on a new IPAS, to people with the rights", () => {
    expect(complianceFor(ctx({}))).toMatchObject({ state: "unanswered", open: [], readOnly: false });
  });

  it("shows nothing on an IPAS that does not ask", () => {
    expect(complianceFor(ctx({ compliance_asked: false }))).toBeNull();
  });

  it("is read-only for anyone without the rights, and on a filed or cancelled IPAS", () => {
    expect(complianceFor(ctx({}, false))).toMatchObject({ state: "unanswered", readOnly: true });
    expect(complianceFor(ctx({ state: "filed" }))).toMatchObject({ readOnly: true });
    expect(complianceFor(ctx({ state: "cancelled", compliance_needed: true, compliance_requirements: [kind("a", "FDA", 5)] }))).toMatchObject({ state: "kinds", readOnly: true });
  });

  it("lists the open kinds in list order after Yes, and drops the done ones", () => {
    const group = complianceFor(
      ctx({ compliance_needed: true, compliance_requirements: [kind("f", "FDA", 50), kind("n", "NTC", 40), kind("d", "DENR", 10, "2026-11-20")] }),
    );
    expect(group.state).toBe("kinds");
    expect(group.open.map((item) => item.label)).toEqual(["NTC", "FDA"]);
    expect(group.kinds.map((item) => item.label)).toEqual(["DENR", "NTC", "FDA"]);
  });

  it("has no to-do after No", () => {
    expect(complianceFor(ctx({ compliance_needed: false }))).toMatchObject({ state: "none", open: [] });
  });
});
