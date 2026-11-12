import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";

import CanvassesPage from "@/pages/purchasing/canvasses/index";
import { renderWithProviders, setupUser } from "@/test/support";
import { db } from "@/test/db/store";
import { stubCanvassListRpcs } from "@/test/stubs/canvassRpc";
import { makeEmployee } from "@/test/factories";

/**
 * The Canvasses page (#973, spec #956): one row per Purchase Request's Canvass, with its status
 * badge and lock; a row opens the request with its Canvass grid.
 */

const mockUser = vi.hoisted(() => ({ current: null }));
vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser.current, isAuthLoading: false, logout: vi.fn() }),
}));

function Where() {
  const location = useLocation();
  return <p data-testid="where">{location.pathname + location.search}</p>;
}

const renderPage = () =>
  renderWithProviders(
    <MemoryRouter initialEntries={["/purchasing/canvasses"]}>
      <Routes>
        <Route path="/purchasing/canvasses" element={<CanvassesPage />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );

describe("the Canvasses page", () => {
  let gloves;
  let tools;

  beforeEach(() => {
    const marco = makeEmployee({ name: "Marco Dizon", has_purchasing_flow: true });
    mockUser.current = marco;
    stubCanvassListRpcs();

    // Gloves: three suppliers, one of two lines won.
    gloves = db.seed("purchase_requests", { title: "PR-0001 Gloves", created_by: marco.id, buyer_id: marco.id });
    const nitrile = db.seed("purchase_request_items", { request_id: gloves.id, name: "Nitrile gloves", status: "still_canvassing", quantity: 1, source: "new", requested_by: marco.id });
    db.seed("purchase_request_items", { request_id: gloves.id, name: "Face mask", status: "still_canvassing", quantity: 1, source: "new", requested_by: marco.id });
    const glovesCanvass = db.seed("request_canvasses", { number: "CNV_0001", request_id: gloves.id, canvasser_id: marco.id });
    const suppliers = ["Acme", "Bolt", "Crest"].map((name, i) =>
      db.seed("request_canvass_suppliers", { canvass_id: glovesCanvass.id, supplier_name: name, sort_order: i }),
    );
    db.seed("request_canvass_winners", { item_id: nitrile.id, supplier_id: suppliers[0].id, reason: "Cheapest" });

    // Tools: one supplier, its only line Purchased, so the Canvass is locked.
    tools = db.seed("purchase_requests", { title: "PR-0002 Tools", created_by: marco.id, buyer_id: marco.id });
    db.seed("purchase_request_items", { request_id: tools.id, name: "Hammer", status: "purchased", quantity: 1, source: "new", requested_by: marco.id });
    const toolsCanvass = db.seed("request_canvasses", { number: "CNV_0002", request_id: tools.id, canvasser_id: marco.id });
    db.seed("request_canvass_suppliers", { canvass_id: toolsCanvass.id, supplier_name: "Delta", sort_order: 0 });
  });

  it("lists one row per request with its counts, status and lock", async () => {
    renderPage();
    const rows = await screen.findAllByTestId("canvass-row");
    expect(rows).toHaveLength(2);

    const first = rows.find((r) => within(r).queryByText("CNV_0001"));
    expect(within(first).getByText("PR-0001 Gloves")).toBeInTheDocument();
    expect(within(first).getByText("Direct request")).toBeInTheDocument();
    expect(within(first).getByText("1 of 2")).toBeInTheDocument();
    expect(within(first).getByText(/Needs winners/i)).toBeInTheDocument();
    expect(within(first).queryByRole("img", { name: "Locked" })).not.toBeInTheDocument();

    const second = rows.find((r) => within(r).queryByText("CNV_0002"));
    expect(within(second).getByText(/Needs suppliers/i)).toBeInTheDocument();
    expect(within(second).getByRole("img", { name: "Locked" })).toBeInTheDocument();
  });

  it("has no Request or Signed off filter, and searches by supplier and product", async () => {
    renderPage();
    const user = setupUser();
    await screen.findAllByTestId("canvass-row");
    expect(screen.queryByRole("tab", { name: /Signed off/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Any request")).not.toBeInTheDocument();

    await user.type(screen.getByPlaceholderText(/Search/), "delta");
    expect(screen.getAllByTestId("canvass-row")).toHaveLength(1);
    expect(screen.getByText("CNV_0002")).toBeInTheDocument();

    await user.clear(screen.getByPlaceholderText(/Search/));
    await user.type(screen.getByPlaceholderText(/Search/), "face mask");
    expect(screen.getAllByTestId("canvass-row")).toHaveLength(1);
    expect(screen.getByText("CNV_0001")).toBeInTheDocument();
  });

  it("opens a row on its request, with the Canvass grid open", async () => {
    renderPage();
    const user = setupUser();
    await user.click(await screen.findByRole("row", { name: "Open Canvass CNV_0001" }));
    expect(await screen.findByTestId("where")).toHaveTextContent(`/purchasing?request=${gloves.id}&canvass=1`);
  });

  it("starts nothing: there is no button to start a Canvass", async () => {
    renderPage();
    await screen.findAllByTestId("canvass-row");
    expect(screen.queryByRole("button", { name: /new canvass|start/i })).not.toBeInTheDocument();
  });
});
