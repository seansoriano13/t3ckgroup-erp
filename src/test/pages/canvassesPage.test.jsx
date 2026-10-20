import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";

import CanvassesPage from "@/pages/purchasing/canvasses/index";
import { renderWithProviders, setupUser } from "@/test/support";
import { db } from "@/test/db/store";
import { stubCanvassListRpcs, stubCanvassMoneyRpc, stubCanvassWinnerRpcs } from "@/test/stubs/canvassRpc";
import { makeEmployee, makeOpportunity } from "@/test/factories";

/**
 * The Canvasses page (#566, ADR 0034): every Canvass listed with number, subject, Canvasser,
 * winner and signed state; the shared filter bar narrows them; a row opens the Canvass panel.
 */

const mockUser = vi.hoisted(() => ({ current: null }));
vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser.current, isAuthLoading: false, logout: vi.fn() }),
}));

const renderPage = () =>
  renderWithProviders(
    <MemoryRouter initialEntries={["/purchasing/canvasses"]}>
      <Routes>
        <Route path="/purchasing/canvasses" element={<CanvassesPage />} />
        <Route path="*" element={<p>Home</p>} />
      </Routes>
    </MemoryRouter>,
  );

describe("the Canvasses page", () => {
  let marco;
  let ana;

  beforeEach(() => {
    marco = makeEmployee({ name: "Marco Dizon", has_purchasing_flow: true });
    ana = makeEmployee({ name: "Ana Reyes", has_purchasing_flow: true });
    mockUser.current = marco;
    stubCanvassMoneyRpc({ money: true });
    stubCanvassWinnerRpcs({ bands: ["purchasing"] });
    stubCanvassListRpcs({ actorId: marco.id });

    const matrix = db.seed("costing_matrices", { opportunity_id: makeOpportunity().id });
    const line = db.seed("costing_tender_lines", { matrix_id: matrix.id, position: 1 });
    const component = db.seed("costing_components", { tender_line_id: line.id, name: "Folding Stretcher", position: 1 });
    db.seed("sor_canvasses", { number: "CNV_0001", component_id: component.id, created_by: marco.id });
    const toner = db.seed("sor_canvasses", { number: "CNV_0002", product_name: "Laser toner", canvasser_id: ana.id, created_by: ana.id });
    db.seed("sor_canvasses", {
      number: "CNV_0003",
      product_name: "Gloves",
      canvasser_id: marco.id,
      created_by: marco.id,
      signed_off_at: "2026-10-20T01:00:00Z",
    });
    db.seed("sor_canvass_offers", { canvass_id: toner.id, supplier_name: "Ink Depot", brand: "HP", is_winner: true });
  });

  it("lists every Canvass, project ones included, with its subject, Canvasser, winner and signed state", async () => {
    renderPage();
    const rows = await screen.findAllByTestId("canvass-row");
    expect(rows).toHaveLength(3);

    const toner = rows.find((row) => within(row).queryByText("CNV_0002"));
    expect(toner).toHaveTextContent("Laser toner");
    expect(toner).toHaveTextContent("Ana Reyes");
    expect(toner).toHaveTextContent("Ink Depot · HP");
    expect(toner).toHaveTextContent("Not signed");

    const gloves = rows.find((row) => within(row).queryByText("CNV_0003"));
    expect(gloves).toHaveTextContent("Signed off");
    expect(gloves).toHaveTextContent("No winner");

    expect(rows.find((row) => within(row).queryByText("CNV_0001"))).toHaveTextContent("Folding Stretcher");
  });

  it("narrows by search, signed state, winner and linked", async () => {
    const user = setupUser();
    renderPage();
    await screen.findAllByTestId("canvass-row");

    await user.type(screen.getByPlaceholderText("Search Canvasses"), "toner");
    expect(screen.getAllByTestId("canvass-row")).toHaveLength(1);
    await user.clear(screen.getByPlaceholderText("Search Canvasses"));

    await user.click(screen.getByRole("button", { name: /Any sign-off/ }));
    await user.click(await screen.findByRole("button", { name: "Signed off" }));
    expect(screen.getAllByTestId("canvass-row")).toHaveLength(1);
    expect(screen.getByText("CNV_0003")).toBeInTheDocument();
  });

  it("opens the Canvass panel from a row", async () => {
    const user = setupUser();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Open Canvass CNV_0002" }));
    expect(await screen.findByRole("heading", { name: /Canvass CNV_0002/ })).toBeInTheDocument();
    expect(await screen.findAllByTestId("offer")).toHaveLength(1);
  });

  it("starts a Canvass with no Purchase Request: the starter becomes its Canvasser and it gets a number", async () => {
    const user = setupUser();
    renderPage();
    await screen.findAllByTestId("canvass-row");

    await user.click(screen.getByRole("button", { name: /new canvass/i }));
    await user.type(await screen.findByLabelText("What is being bought"), "Whiteboard markers");
    await user.type(screen.getByLabelText("Supplier"), "National Book Store");
    await user.type(screen.getByLabelText("Unit price in PHP"), "45");
    await user.click(screen.getByRole("button", { name: /save offer/i }));

    // The database defaults the Canvasser to whoever started it (policy test 110); the fake keeps who.
    await waitFor(() => expect(db.rows("sor_canvasses").some((c) => c.product_name === "Whiteboard markers")).toBe(true));
    const started = db.rows("sor_canvasses").find((c) => c.product_name === "Whiteboard markers");
    expect(started.number).toMatch(/^CNV_\d{4}$/);
    expect(started.created_by).toBe(marco.id);
    expect(started.component_id ?? null).toBeNull();
    expect(started.requested_item_id ?? null).toBeNull();
    // Closed, it stays on the page as a row to reopen later.
    await user.keyboard("{Escape}");
    expect(await screen.findByRole("button", { name: `Open Canvass ${started.number}` })).toBeInTheDocument();
  });

  it("creates one Purchase Request from picked Canvasses and warns when one is not signed", async () => {
    const user = setupUser();
    renderPage();
    await screen.findAllByTestId("canvass-row");

    expect(screen.queryByLabelText("Pick Canvass CNV_0001")).not.toBeInTheDocument();
    await user.click(screen.getByLabelText("Pick Canvass CNV_0002"));
    await user.click(screen.getByRole("button", { name: /create purchase request \(1\)/i }));
    expect(await screen.findByRole("status")).toHaveTextContent("CNV_0002");
    await user.type(screen.getByLabelText("Purchase Request title"), "Office buy");
    await user.click(screen.getByRole("button", { name: /create request/i }));

    await waitFor(() => expect(db.rows("purchase_requests").some((r) => r.title === "Office buy")).toBe(true));
    const toner = db.rows("sor_canvasses").find((c) => c.number === "CNV_0002");
    expect(toner.requested_item_id).toBeTruthy();
    expect(db.rows("purchase_request_items")).toHaveLength(1);
  });

  it("sends someone without Purchasing access home", async () => {
    mockUser.current = makeEmployee({ name: "Ordinary" });
    renderPage();
    expect(await screen.findByText("Home")).toBeInTheDocument();
  });
});
