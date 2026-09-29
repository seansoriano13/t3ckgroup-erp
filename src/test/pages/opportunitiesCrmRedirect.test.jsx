import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router";
import OpportunitiesRedirect from "../../pages/opportunities/index";
import OpportunitiesCommissionRedirect from "../../pages/opportunities/commission/index";
import OpportunitiesCommissionFormulaRedirect from "../../pages/opportunities/commission-formula/index";
import CrmRedirect from "../../pages/crm/index";
import CrmCommissionRedirect from "../../pages/crm/commission/index";
import CrmCommissionFormulaRedirect from "../../pages/crm/commission-formula/index";

// The module has had three names: /opportunities, then /crm (#206), now /sors
// (ADR 0024). Both older routes are kept permanently — notificationRouter has
// been minting /crm deep links into notifications people still have unread, and
// /opportunities links predate those.
//
// Both point at /sors *directly*. Chaining /opportunities through /crm would
// work today and become a redirect loop the first time somebody edits one of
// them, so each legacy route names the real destination itself.
describe("legacy register routes", () => {
  function SorsRegisterStub() {
    const location = useLocation();
    return <div>SORS Register: {location.search}</div>;
  }

  function renderAt(path, routes) {
    return render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          {routes}
          <Route path="/sors" element={<SorsRegisterStub />} />
          <Route path="/sors/commission" element={<div>Commission Dashboard Page</div>} />
          <Route path="/sors/commission-formula" element={<div>Commission Formula Page</div>} />
        </Routes>
      </MemoryRouter>
    );
  }

  describe("/opportunities", () => {
    it("redirects to /sors, preserving the query string", () => {
      renderAt("/opportunities?id=abc123", <Route path="/opportunities" element={<OpportunitiesRedirect />} />);
      expect(screen.getByText("SORS Register: ?id=abc123")).toBeInTheDocument();
    });

    it("redirects /opportunities/commission to /sors/commission", () => {
      renderAt(
        "/opportunities/commission?tab=departments",
        <Route path="/opportunities/commission" element={<OpportunitiesCommissionRedirect />} />
      );
      expect(screen.getByText("Commission Dashboard Page")).toBeInTheDocument();
    });

    it("redirects /opportunities/commission-formula to /sors/commission-formula", () => {
      renderAt(
        "/opportunities/commission-formula",
        <Route path="/opportunities/commission-formula" element={<OpportunitiesCommissionFormulaRedirect />} />
      );
      expect(screen.getByText("Commission Formula Page")).toBeInTheDocument();
    });
  });

  describe("/crm", () => {
    it("redirects to /sors, preserving the query string", () => {
      renderAt("/crm?id=abc123", <Route path="/crm" element={<CrmRedirect />} />);
      expect(screen.getByText("SORS Register: ?id=abc123")).toBeInTheDocument();
    });

    it("redirects /crm/commission to /sors/commission", () => {
      renderAt("/crm/commission", <Route path="/crm/commission" element={<CrmCommissionRedirect />} />);
      expect(screen.getByText("Commission Dashboard Page")).toBeInTheDocument();
    });

    it("redirects /crm/commission-formula to /sors/commission-formula", () => {
      renderAt(
        "/crm/commission-formula",
        <Route path="/crm/commission-formula" element={<CrmCommissionFormulaRedirect />} />
      );
      expect(screen.getByText("Commission Formula Page")).toBeInTheDocument();
    });
  });
});
