import { describe, expect, it } from "vitest";

import { gatesFor, nowGate, waitingSections } from "./gates";

const who = (name, signedAt = "2026-09-05T06:40:00.000Z") => ({ signedBy: { name }, signedAt });

/** A digest with just what the gates read. */
function digestOf({ status = "encoding", s1 = {}, s3 = {}, s7 = {}, open = true, filed = false, cancelled = false } = {}) {
  const costsComplete = status === "lc_odoo_done" || status === "checked";
  return {
    open,
    filed,
    cancelled,
    computationStatus: status,
    costsComplete,
    s1: { prepared: null, approved: null, ...s1 },
    s3: { prepared: null, approved: null, ...s3 },
    s7: { received: null, noted: null, checked: null, approved: null, ...s7 },
  };
}

const gatesOf = (overrides) => gatesFor(digestOf(overrides));
const byKey = (gates, key) => gates.find((gate) => gate.key === key);
const approvedBoth = { s1: { approved: who("Ana") }, s3: { approved: who("Ben") } };

describe("gatesFor: the one Now", () => {
  it("is Received, not LC Odoo Done, when the status is encoding and sections 1 and 2 are approved", () => {
    const gates = gatesOf({ status: "encoding", ...approvedBoth });
    expect(nowGate(gates)?.key).toBe("received");
    expect(byKey(gates, "costs").now).toBe(false);
    expect(byKey(gates, "costs").state).toBe("waiting");
  });

  it("is the costs gate once the status is encoded and sections 1 and 2 are approved", () => {
    const gates = gatesOf({ status: "encoded", ...approvedBoth });
    expect(nowGate(gates)?.key).toBe("costs");
    expect(byKey(gates, "received").state).toBe("waiting");
  });

  it("is the first section while nothing is approved", () => {
    expect(nowGate(gatesOf({ status: "encoding" })).key).toBe("purchasing");
  });

  it("is the second section once section 1 is approved", () => {
    const gates = gatesOf({ s1: { approved: who("Ana") } });
    expect(nowGate(gates).key).toBe("finance");
  });

  it("is Noted and Checked once Received is given", () => {
    const gates = gatesOf({ status: "encoding", ...approvedBoth, s7: { received: who("Fi") } });
    expect(nowGate(gates).key).toBe("noted-checked");
  });

  it("is none when no unmet gate has its prerequisites met, and costs is never Now before its turn", () => {
    const gates = gatesOf({ status: "encoding", ...approvedBoth, s7: { received: who("Fi"), noted: who("No"), checked: who("Ch") } });
    expect(nowGate(gates)).toBeNull();
    expect(byKey(gates, "costs").now).toBe(false);
    expect(byKey(gates, "costs").state).toBe("waiting");
  });

  it("is the costs gate once the status is encoded and every earlier gate is given", () => {
    const gates = gatesOf({ status: "encoded", ...approvedBoth, s7: { received: who("Fi"), noted: who("No"), checked: who("Ch") } });
    expect(nowGate(gates)?.key).toBe("costs");
  });

  it("stays the costs gate through LC GS Done, until LC Odoo Done", () => {
    const upTo = { ...approvedBoth, s7: { received: who("Fi"), noted: who("No"), checked: who("Ch") } };
    expect(nowGate(gatesOf({ status: "lc_gs_done", ...upTo }))?.key).toBe("costs");
    expect(nowGate(gatesOf({ status: "lc_odoo_done", ...upTo }))?.key).toBe("approved");
  });

  it("is never more than one gate", () => {
    const statuses = ["encoding", "encoded", "lc_gs_done", "lc_odoo_done", "checked"];
    const flags = [null, who("X")];
    for (const status of statuses) {
      for (const s1Approved of flags) {
        for (const s3Approved of flags) {
          for (const received of flags) {
            for (const noted of flags) {
              for (const checked of flags) {
                for (const approved of flags) {
                  const gates = gatesOf({
                    status,
                    s1: { approved: s1Approved },
                    s3: { approved: s3Approved },
                    s7: { received, noted, checked, approved },
                  });
                  const nows = gates.filter((gate) => gate.now);
                  expect(nows.length).toBeLessThanOrEqual(1);
                  expect(nows.length === 1).toBe(gates.some((gate) => !gate.done && gate.prereqMet));
                }
              }
            }
          }
        }
      }
    }
  });

  it("is none on a filed or cancelled IPAS", () => {
    expect(nowGate(gatesOf({ open: false, filed: true, status: "checked", ...approvedBoth, s7: { approved: who("Ap") } }))).toBeNull();
    expect(nowGate(gatesOf({ open: false, cancelled: true }))).toBeNull();
  });
});

describe("gatesFor: names, states and lines", () => {
  it("names each gate by section, role and state", () => {
    const gates = gatesOf({ status: "encoding", s1: { approved: who("M. Ramos") } });
    expect(byKey(gates, "finance").accessibleName).toBe("Section 2, Purchasing & Finance, Approved, now");
    expect(byKey(gates, "purchasing").accessibleName).toBe("Section 1, Purchasing, Approved, done");
    expect(byKey(gates, "received").accessibleName).toBe("Section 4, Filing, Received, waiting");
  });

  it("labels the gates <no> · <name> with their role", () => {
    const gates = gatesOf({ status: "encoding" });
    expect(gates.map((gate) => [gate.label, gate.role])).toEqual([
      ["1 · Purchasing", "Approved"],
      ["2 · Purchasing & Finance", "Approved"],
      ["3 · Computation status & Landed Cost", "LC Odoo Done"],
      ["4 · Filing", "Received"],
      ["4 · Filing", "Noted and Checked"],
      ["4 · Filing", "Approved"],
    ]);
  });

  it("says who approved and when", () => {
    const gates = gatesOf({ status: "encoding", s1: { approved: who("M. Ramos") } });
    expect(byKey(gates, "purchasing").line).toMatch(/^Approved by M\. Ramos · Sep 5, 2026/);
  });

  it("keeps Noted and Checked in either order, and says who is still open", () => {
    const open = gatesOf({ status: "encoding", ...approvedBoth, s7: { received: who("Fi") } });
    expect(byKey(open, "noted-checked").line).toBe("Noted and Checked, in either order");
    const noted = gatesOf({ status: "encoding", ...approvedBoth, s7: { received: who("Fi"), noted: who("Ni") } });
    expect(byKey(noted, "noted-checked").line).toBe("Noted by Ni, Checked still open");
  });

  it("names the sections waited on, once each", () => {
    expect(waitingSections(gatesOf({ status: "encoding" }))).toBe("1 · Purchasing and 2 · Purchasing & Finance");
    expect(waitingSections(gatesOf({ status: "encoding", ...approvedBoth }))).toBe("4 · Filing");
  });
});
