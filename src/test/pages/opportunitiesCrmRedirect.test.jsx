import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router";
import OpportunitiesRedirect from "../../pages/opportunities/index";
import OpportunitiesCommissionRedirect from "../../pages/opportunities/commission/index";
import OpportunitiesCommissionFormulaRedirect from "../../pages/opportunities/commission-formula/index";
import CrmRedirect from "../../pages/crm/index";
import CrmCommissionRedirect from "../../pages/crm/commission/index";
import CrmCommissionFormulaRedirect from "../../pages/crm/commission-formula/index";
import SorsCommissionFormulaRedirect from "../../pages/sors/commission-formula/index";

// The module has had three names: /opportunities, then /crm (#206), now /sors
// (ADR 0024). Both older routes are kept permanently — notificationRouter has
// been minting /crm deep links into notifications people still have unread, and
// /opportunities links predate those.
//
// Both point at /sors *directly*. Chaining /opportunities through /crm would
// work today and become a redirect loop the first time somebody edits one of
// them, so each legacy route names the real destination itself. The Commission
// Formula has since folded into the dashboard's Formula tab, so every
// commission-formula route lands on /sors/commission?tab=formula.
describe("legacy register routes", () => {
  function CommissionDashboardStub() {
    const location = useLocation();
    return <div>Commission Dashboard Page{location.search}</div>;
  }

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
          <Route path="/sors/commission" element={<CommissionDashboardStub />} />
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
      expect(screen.getByText(/^Commission Dashboard Page/)).toBeInTheDocument();
    });

    it("redirects /opportunities/commission-formula to the dashboard's Formula tab", () => {
      renderAt(
        "/opportunities/commission-formula",
        <Route path="/opportunities/commission-formula" element={<OpportunitiesCommissionFormulaRedirect />} />
      );
      expect(screen.getByText("Commission Dashboard Page?tab=formula")).toBeInTheDocument();
    });
  });

  describe("/crm", () => {
    it("redirects to /sors, preserving the query string", () => {
      renderAt("/crm?id=abc123", <Route path="/crm" element={<CrmRedirect />} />);
      expect(screen.getByText("SORS Register: ?id=abc123")).toBeInTheDocument();
    });

    it("redirects /crm/commission to /sors/commission", () => {
      renderAt("/crm/commission", <Route path="/crm/commission" element={<CrmCommissionRedirect />} />);
      expect(screen.getByText(/^Commission Dashboard Page/)).toBeInTheDocument();
    });

    it("redirects /crm/commission-formula to the dashboard's Formula tab", () => {
      renderAt(
        "/crm/commission-formula",
        <Route path="/crm/commission-formula" element={<CrmCommissionFormulaRedirect />} />
      );
      expect(screen.getByText("Commission Dashboard Page?tab=formula")).toBeInTheDocument();
    });
  });

  describe("/sors/commission-formula", () => {
    it("redirects to the dashboard's Formula tab", () => {
      renderAt("/sors/commission-formula", <Route path="/sors/commission-formula" element={<SorsCommissionFormulaRedirect />} />);
      expect(screen.getByText("Commission Dashboard Page?tab=formula")).toBeInTheDocument();
    });
  });
});
