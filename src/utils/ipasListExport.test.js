import { describe, expect, it } from "vitest";
import { IPAS_EXPORT_HEADER, ipasExportRows } from "./ipasListExport";
import { formatDay } from "./ipasPayments";

const row = (over = {}, figures = {}) => ({
  number: "TGIPAS_100",
  created_at: "2026-11-01T01:00:00Z",
  creator: { name: "Ana", call_sign: "AN" },
  sors: [],
  supplier: "Scorpe",
  po_number: "P02552",
  statusSteps: [{ step: "in_transit", on: "2026-11-18" }],
  figures: { amount: 1000, currency: "PHP", status: "in_transit", onHold: false, paymentScheme: "", paymentPercents: "", ...figures },
  ...over,
});

const cell = (name, values) => values[IPAS_EXPORT_HEADER.indexOf(name)];

describe("ipasExportRows: the IPAS Status columns (#1157)", () => {
  it("carries Status in the team's own words and the Status date beside it", () => {
    expect(IPAS_EXPORT_HEADER).toContain("Status");
    expect(IPAS_EXPORT_HEADER).toContain("Status date");

    const [values] = ipasExportRows([row()]);

    expect(values).toHaveLength(IPAS_EXPORT_HEADER.length);
    expect(cell("Status", values)).toBe("In Transit");
    expect(cell("Status date", values)).toBe(formatDay("2026-11-18"));
  });

  it("reads On-Hold over the step it stopped at", () => {
    const [values] = ipasExportRows([row({}, { onHold: true })]);

    expect(cell("Status", values)).toBe("On-Hold · In Transit");
  });

  it("leaves both blank for an IPAS with no status (a cancelled one)", () => {
    const [values] = ipasExportRows([row({ statusSteps: [] }, { status: null })]);

    expect(cell("Status", values)).toBeNull();
    expect(cell("Status date", values)).toBeNull();
  });
});

describe("ipasExportRows: the Payment status column (#1188)", () => {
  it("writes the Payment status in words beside the others, blank for a cancelled IPAS", () => {
    expect(IPAS_EXPORT_HEADER).toContain("Payment status");
    const [values] = ipasExportRows([row({}, { paymentStatus: "dp_paid" })]);
    expect(values).toHaveLength(IPAS_EXPORT_HEADER.length);
    expect(cell("Payment status", values)).toBe("DP paid");
    const [cancelled] = ipasExportRows([row({}, { paymentStatus: null })]);
    expect(cell("Payment status", cancelled)).toBeNull();
  });
});

describe("ipasExportRows: the Withholding (2307) column (#1210)", () => {
  it("writes the pick in words for a Local IPAS, and nothing when it is not set", () => {
    expect(IPAS_EXPORT_HEADER).toContain("Withholding (2307)");
    const [two] = ipasExportRows([row({ source: "local", withholding: "2" })]);
    expect(two).toHaveLength(IPAS_EXPORT_HEADER.length);
    expect(cell("Withholding (2307)", two)).toBe("2%");
    const [na] = ipasExportRows([row({ source: "local", withholding: "not_applicable" })]);
    expect(cell("Withholding (2307)", na)).toBe("Not applicable");
    const [unset] = ipasExportRows([row({ source: "local", withholding: null })]);
    expect(cell("Withholding (2307)", unset)).toBeNull();
  });

  it("never writes one for an Import IPAS", () => {
    const [values] = ipasExportRows([row({ source: "import", withholding: "1" })]);
    expect(cell("Withholding (2307)", values)).toBeNull();
  });
});
