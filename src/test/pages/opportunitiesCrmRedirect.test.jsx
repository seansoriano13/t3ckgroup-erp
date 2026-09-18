import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router";
import OpportunitiesRedirect from "../../pages/opportunities/index";
import OpportunitiesCommissionRedirect from "../../pages/opportunities/commission/index";
import OpportunitiesCommissionFormulaRedirect from "../../pages/opportunities/commission-formula/index";

// Issue #206: /opportunities moved to /crm. Old links — including ones
// already sitting in a sent notification — must keep landing on the same
// page or SOR, so these preserve the query string and hash across the move.
describe("Opportunities → CRM redirects", () => {
  function CrmRegisterStub() {
    const location = useLocation();
    return <div>CRM Register: {location.search}</div>;
  }

  it("redirects /opportunities?id=… to /crm?id=…", () => {
    render(
      <MemoryRouter initialEntries={["/opportunities?id=abc123"]}>
        <Routes>
          <Route path="/opportunities" element={<OpportunitiesRedirect />} />
          <Route path="/crm" element={<CrmRegisterStub />} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByText("CRM Register: ?id=abc123")).toBeInTheDocument();
  });

  it("redirects /opportunities/commission to /crm/commission, preserving the query string", () => {
    render(
      <MemoryRouter initialEntries={["/opportunities/commission?tab=departments"]}>
        <Routes>
          <Route path="/opportunities/commission" element={<OpportunitiesCommissionRedirect />} />
          <Route path="/crm/commission" element={<div>Commission Dashboard Page</div>} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByText("Commission Dashboard Page")).toBeInTheDocument();
  });

  it("redirects /opportunities/commission-formula to /crm/commission-formula", () => {
    render(
      <MemoryRouter initialEntries={["/opportunities/commission-formula"]}>
        <Routes>
          <Route path="/opportunities/commission-formula" element={<OpportunitiesCommissionFormulaRedirect />} />
          <Route path="/crm/commission-formula" element={<div>Commission Formula Page</div>} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByText("Commission Formula Page")).toBeInTheDocument();
  });
});
