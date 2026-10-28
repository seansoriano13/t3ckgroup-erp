import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import ComplianceColumn from "./ComplianceColumn";
import { lineVerdict } from "./evaluationTeams";

/**
 * The sheet's Compliance column (#706): the team pill, the verdict and its note. Who may mark a row is
 * the database's to decide (the team lists); here the column only offers the controls to a member of the
 * row's team and shows everyone else the verdict.
 */

const part = (fields) => ({ id: fields.id ?? "p1", compliance: null, compliance_note: null, recommended_alternative: null, ...fields });
const line = (fields) => ({ id: "l1", number: 1, evaluating_team: "RRD", components: [part({})], ...fields });

describe("lineVerdict", () => {
  it("is Deviates when any part deviates, Complies when all comply, else not judged", () => {
    expect(lineVerdict(line({ components: [part({ compliance: "complies" }), part({ id: "p2", compliance: "deviates" })] }))).toBe("deviates");
    expect(lineVerdict(line({ components: [part({ compliance: "complies" }), part({ id: "p2", compliance: "complies" })] }))).toBe("complies");
    expect(lineVerdict(line({ components: [part({ compliance: "complies" }), part({ id: "p2" })] }))).toBeNull();
    expect(lineVerdict(line({ components: [] }))).toBeNull();
  });
});

describe("ComplianceColumn", () => {
  it("shows the team pill, the verdict and the note to someone outside the team, with nothing to change", () => {
    const deviating = line({ components: [part({ compliance: "deviates", compliance_note: "Thread is 50 mm, not 65 mm" })] });
    render(<ComplianceColumn line={deviating} myTeams={["IOE"]} canSetTeam={false} />);

    expect(screen.getByText("RRD")).toBeInTheDocument();
    expect(screen.getByText("Deviates")).toBeInTheDocument();
    expect(screen.getByText("Thread is 50 mm, not 65 mm")).toBeInTheDocument();
    expect(screen.queryByLabelText("Compliance 1")).not.toBeInTheDocument();
  });

  it("reads Not judged until a verdict is marked, and No team before one is named", () => {
    render(<ComplianceColumn line={line({ evaluating_team: null })} myTeams={["RRD"]} canSetTeam={false} />);

    expect(screen.getByText("No team")).toBeInTheDocument();
    expect(screen.getByText("Not judged")).toBeInTheDocument();
    expect(screen.queryByLabelText("Compliance 1")).not.toBeInTheDocument();
  });

  it("offers the verdict to a member of the row's team", () => {
    render(<ComplianceColumn line={line()} myTeams={["RRD"]} canSetTeam={false} />);

    expect(screen.getByLabelText("Compliance 1")).toBeInTheDocument();
  });

  it("lets Sales or Purchasing choose the team", () => {
    render(<ComplianceColumn line={line()} myTeams={[]} canSetTeam />);

    expect(screen.getByLabelText("Evaluating team 1")).toBeInTheDocument();
  });
});
