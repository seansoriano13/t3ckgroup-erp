import { describe, it, expect } from "vitest";
import { matchesSearch, matchesSorCode, sorSearchFields } from "./sorSearch";
import { filterIpas } from "./ipas";
import { filterMatrixPage } from "./costingMatrixPage";

const sor = { salesReference: "S04081", sorCode: "SOR-198", projectTitle: "BFP Command Bus" };

describe("the shared SOR search", () => {
  it("matches the SO number, SOR number and project, in any case", () => {
    const fields = sorSearchFields(sor);
    expect(matchesSearch("s04081", fields)).toBe(true);
    expect(matchesSearch("SOR-198", fields)).toBe(true);
    expect(matchesSearch("command", fields)).toBe(true);
    expect(matchesSearch("nothing", fields)).toBe(false);
  });

  it("matches the SO number and project typed together, folding extra spaces", () => {
    const fields = sorSearchFields(sor);
    expect(matchesSearch("S04081 BFP Command Bus", fields)).toBe(true);
    expect(matchesSearch("  s04081   bfp ", fields)).toBe(true);
    expect(matchesSearch("SOR-198 BFP", fields)).toBe(true);
  });

  it("matches everything when empty, and nothing for the SOR number", () => {
    expect(matchesSearch("   ", [])).toBe(true);
    expect(matchesSorCode("", "SOR-198")).toBe(false);
    expect(matchesSorCode("sor-19", "SOR-198")).toBe(true);
  });

  it("makes the IPAS list and the Costing Matrix page behave the same", () => {
    const ipasRows = [{ state: "open", number: "TGIPAS_50", po_number: "P1", supplier: "Acme", sors: [sor] }];
    const matrixRows = [
      {
        sorNumber: sor.sorCode,
        soNumber: sor.salesReference,
        projectTitle: sor.projectTitle,
        stage: "",
        entities: [],
        comparison: { actualLower: false },
      },
    ];
    for (const term of ["S04081 BFP Command Bus", "sor-198", "bus", "S04081  BFP", "zzz"]) {
      expect(filterIpas(ipasRows, { search: term }).length).toBe(filterMatrixPage(matrixRows, { search: term }).length);
    }
    expect(filterIpas(ipasRows, { search: "S04081 BFP Command Bus" })).toHaveLength(1);
  });
});
