import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";

import PmsPage from "@/pages/purchasing/pms/[id]";
import { renderWithProviders, setupUser } from "@/test/support";
import { stubRpc } from "@/test/msw/server";
import { makeEmployee, makeOpportunity } from "@/test/factories";

/**
 * The PMS page (#1021): one SOR's PMS file on /purchasing/pms/:id. A reader who may see the SOR gets the
 * shared sections (here the Purchase Request card's neighbours are stubbed empty, so the Beta tag and the
 * Open SOR button prove the page); a reader who may not read the SOR at all gets the plain not-found block.
 */

let authUser;
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: authUser, isAuthLoading: false }) }));
vi.mock("@/components/sor/modal/PmsSections", () => ({
  default: ({ opportunityId }) => <div data-testid="pms-sections">{opportunityId}</div>,
}));

function SorRoute() {
  const location = useLocation();
  return <p data-testid="sor-route">{`${location.pathname}${location.search}`}</p>;
}

function open(id) {
  renderWithProviders(
    <MemoryRouter initialEntries={[`/purchasing/pms/${id}`]}>
      <Routes>
        <Route path="/purchasing/pms/:id" element={<PmsPage />} />
        <Route path="/sors" element={<SorRoute />} />
      </Routes>
    </MemoryRouter>,
  );
  return setupUser();
}

describe("the PMS page", () => {
  beforeEach(() => {
    authUser = { id: makeEmployee().id, isSuperAdmin: true };
  });

  it("shows the shared sections for a reader with full access, and Open SOR goes to the SOR on its PMS tab", async () => {
    const deal = makeOpportunity({ sor_code: "SOR-777", sales_reference: "S07070" });
    const user = open(deal.id);

    expect(await screen.findByTestId("pms-sections")).toHaveTextContent(deal.id);
    await user.click(screen.getByRole("button", { name: "Open SOR" }));
    expect(await screen.findByTestId("sor-route")).toHaveTextContent(`/sors?open=sor%3A${deal.id}&view=pms`);
  });

  it("shows the not-found block for a reader who may not see the SOR", async () => {
    stubRpc("costing_matrix_header", null);
    open("00000000-0000-4000-8000-00000000dead");

    expect(await screen.findByTestId("record-not-found")).toHaveTextContent(/not found, or it is not yours to see/);
    expect(screen.queryByTestId("pms-sections")).not.toBeInTheDocument();
  });
});
