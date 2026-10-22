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

  // A Canvass already turned into a Purchase Request: its item was cancelled afterwards.
  const seedRequested = () => {
    const request = db.seed("purchase_requests", { title: "Office buy", created_by: marco.id });
    const item = db.seed("purchase_request_items", { request_id: request.id, source: "new", name: "Stapler", status: "cancelled", quantity: 1, requested_by: marco.id });
    db.seed("sor_canvasses", { number: "CNV_0004", requested_item_id: item.id, created_by: marco.id });
    return request;
  };

  it("says in the Request column what each Canvass needs, or which request it became", async () => {
    const request = seedRequested();
    renderPage();
    const rows = await screen.findAllByTestId("canvass-row");
    const rowOf = (number) => rows.find((row) => within(row).queryByText(number));

    expect(rowOf("CNV_0003")).toHaveTextContent("Needs winner");
    expect(rowOf("CNV_0002")).toHaveTextContent("Ready to request");
    expect(rowOf("CNV_0001")).not.toHaveTextContent(/needs winner|ready to request|request/i);

    const link = within(rowOf("CNV_0004")).getByRole("link", { name: /Office buy · Cancelled/ });
    expect(link).toHaveAttribute("href", `/purchasing?request=${request.id}`);
  });

  it("narrows by whether a request was made", async () => {
    seedRequested();
    const user = setupUser();
    renderPage();
    await screen.findAllByTestId("canvass-row");

    await user.click(screen.getByRole("button", { name: /Any request/ }));
    await user.click(await screen.findByRole("button", { name: "Request created" }));
    expect(screen.getAllByTestId("canvass-row")).toHaveLength(1);
    expect(screen.getByText("CNV_0004")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Request created/ }));
    await user.click(await screen.findByRole("button", { name: "Not requested yet" }));
    expect(screen.getAllByTestId("canvass-row").map((row) => row.textContent.match(/CNV_\d+/)[0]).sort()).toEqual(["CNV_0002", "CNV_0003"]);
  });

  it("shows the same sign at the top of the panel, and none on a Component Canvass", async () => {
    const request = seedRequested();
    const user = setupUser();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Open Canvass CNV_0003" }));
    expect(await screen.findByTestId("canvass-request-strip")).toHaveTextContent("Needs winner");
    await user.click(screen.getByRole("button", { name: "Close" }));

    await user.click(await screen.findByRole("button", { name: "Open Canvass CNV_0002" }));
    expect(await screen.findByTestId("canvass-request-strip")).toHaveTextContent("Ready to request");
    await user.click(screen.getByRole("button", { name: "Close" }));

    await user.click(await screen.findByRole("button", { name: "Open Canvass CNV_0004" }));
    const strip = await screen.findByTestId("canvass-request-strip");
    await waitFor(() => expect(within(strip).getByRole("link", { name: /Office buy · Cancelled/ })).toHaveAttribute("href", `/purchasing?request=${request.id}`));
    await user.click(screen.getByRole("button", { name: "Close" }));

    await user.click(await screen.findByRole("button", { name: "Open Canvass CNV_0001" }));
    await screen.findByRole("heading", { name: /Canvass CNV_0001/ });
    expect(screen.queryByTestId("canvass-request-strip")).not.toBeInTheDocument();
  });

  it("opens the Canvass panel from a row", async () => {
    const user = setupUser();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Open Canvass CNV_0002" }));
    expect(await screen.findByRole("heading", { name: /Canvass CNV_0002/ })).toBeInTheDocument();
    expect(await screen.findAllByTestId("offer")).toHaveLength(1);
    // Offers sit side by side in three columns, the same as the New Canvass form.
    expect(screen.getByTestId("offers-grid")).toHaveClass("md:grid-cols-3");
  });

  it("opens the Canvass from anywhere on its row, not just the number", async () => {
    const user = setupUser();
    renderPage();
    const rows = await screen.findAllByTestId("canvass-row");
    const toner = rows.find((row) => within(row).queryByText("CNV_0002"));
    await user.click(within(toner).getByText("Ana Reyes"));
    expect(await screen.findByRole("heading", { name: /Canvass CNV_0002/ })).toBeInTheDocument();
  });

  it("picking a row's checkbox does not open it", async () => {
    const user = setupUser();
    renderPage();
    await screen.findAllByTestId("canvass-row");
    await user.click(screen.getByLabelText("Pick Canvass CNV_0002"));
    expect(screen.queryByRole("heading", { name: /Canvass CNV_0002/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create purchase request \(1\)/i })).toBeInTheDocument();
  });

  const fillOffer = async (user, canvass, offer, { supplier, price }) => {
    const label = `Canvass ${canvass} offer ${offer}`;
    await user.type(screen.getByLabelText(`${label} supplier`), supplier);
    await user.type(screen.getByLabelText(`${label} unit price`), price);
  };

  it("starts several Canvasses at once, three offers side by side in each, with the winner picked in the row", async () => {
    const user = setupUser();
    renderPage();
    await screen.findAllByTestId("canvass-row");

    await user.click(screen.getByRole("button", { name: /new canvass/i }));
    expect(await screen.findAllByTestId("new-canvass-offer")).toHaveLength(3);

    await user.type(screen.getByLabelText("Canvass 1 product"), "Whiteboard markers");
    await fillOffer(user, 1, 1, { supplier: "National Book Store", price: "45" });
    await fillOffer(user, 1, 2, { supplier: "Pen Depot", price: "39" });
    await fillOffer(user, 1, 3, { supplier: "Office Hub", price: "42" });
    await user.click(screen.getByRole("button", { name: "Pick canvass 1 offer 2 as the winner" }));

    await user.click(screen.getByRole("button", { name: /add another canvass/i }));
    expect(await screen.findAllByTestId("new-canvass-offer")).toHaveLength(6);
    await user.type(screen.getByLabelText("Canvass 2 product"), "Stapler");
    await fillOffer(user, 2, 1, { supplier: "Staple Co", price: "120" });

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(db.rows("sor_canvasses").filter((c) => ["Whiteboard markers", "Stapler"].includes(c.product_name))).toHaveLength(2));
    const markers = db.rows("sor_canvasses").find((c) => c.product_name === "Whiteboard markers");
    expect(markers.number).toMatch(/^CNV_\d{4}$/);
    expect(markers.created_by).toBe(marco.id);
    expect(markers.component_id ?? null).toBeNull();
    expect(markers.requested_item_id ?? null).toBeNull();
    const offers = db.rows("sor_canvass_offers").filter((o) => o.canvass_id === markers.id);
    expect(offers.map((o) => o.supplier_name).sort()).toEqual(["National Book Store", "Office Hub", "Pen Depot"]);
    await waitFor(() => expect(db.rows("sor_canvass_offers").find((o) => o.canvass_id === markers.id && o.is_winner)?.supplier_name).toBe("Pen Depot"));
    // Closed, each stays on the page as a row to reopen later.
    expect(await screen.findByRole("button", { name: `Open Canvass ${markers.number}` })).toBeInTheDocument();
  }, 20_000);

  it("saves the Canvasses and creates one Purchase Request for them in one step", async () => {
    const user = setupUser();
    renderPage();
    await screen.findAllByTestId("canvass-row");
    await user.click(screen.getByRole("button", { name: /new canvass/i }));

    await user.type(await screen.findByLabelText("Canvass 1 product"), "Whiteboard markers");
    await fillOffer(user, 1, 1, { supplier: "National Book Store", price: "45" });
    await user.click(screen.getByRole("button", { name: "Pick canvass 1 offer 1 as the winner" }));

    // Needs a title before the one-step button is on.
    expect(screen.getByRole("button", { name: /save and create purchase request/i })).toBeDisabled();
    await user.type(screen.getByLabelText("Purchase Request title"), "Office buy");
    await user.click(screen.getByRole("button", { name: /save and create purchase request/i }));

    await waitFor(() => expect(db.rows("purchase_requests").some((r) => r.title === "Office buy")).toBe(true));
    const markers = db.rows("sor_canvasses").find((c) => c.product_name === "Whiteboard markers");
    expect(markers.requested_item_id).toBeTruthy();
  });

  it("asks what is being bought before a row can be saved", async () => {
    const user = setupUser();
    renderPage();
    await screen.findAllByTestId("canvass-row");
    await user.click(screen.getByRole("button", { name: /new canvass/i }));

    await fillOffer(user, 1, 1, { supplier: "National Book Store", price: "45" });
    expect(await screen.findByRole("alert")).toHaveTextContent("Say what is being bought.");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("creates the Purchase Request from inside a Canvass that has a winner", async () => {
    const user = setupUser();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Open Canvass CNV_0002" }));
    await user.click(await screen.findByRole("button", { name: /^create purchase request$/i }));
    await user.type(await screen.findByLabelText("Purchase Request title"), "Toner buy");
    await user.click(screen.getByRole("button", { name: /create request/i }));

    await waitFor(() => expect(db.rows("purchase_requests").some((r) => r.title === "Toner buy")).toBe(true));
    const toner = db.rows("sor_canvasses").find((c) => c.number === "CNV_0002");
    expect(toner.requested_item_id).toBeTruthy();
  });

  it("offers no Purchase Request button inside a Canvass on a Component", async () => {
    const user = setupUser();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Open Canvass CNV_0001" }));
    await screen.findByRole("heading", { name: /Canvass CNV_0001/ });
    expect(screen.queryByRole("button", { name: /^create purchase request$/i })).not.toBeInTheDocument();
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
});

describe("the Canvasses page opened from a Requested Item", () => {
  const renderAt = (url) =>
    renderWithProviders(
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/purchasing/canvasses" element={<CanvassesPage />} />
          <Route path="*" element={<p>Home</p>} />
        </Routes>
      </MemoryRouter>,
    );

  it("lets a reader without Purchasing access in, instead of sending them home", async () => {
    mockUser.current = makeEmployee({ name: "Ana Reyes", has_purchasing_flow: false });
    stubCanvassMoneyRpc({ money: false });
    stubCanvassWinnerRpcs({ bands: [] });
    stubCanvassListRpcs({ actorId: mockUser.current.id });
    renderAt("/purchasing/canvasses");
    expect(await screen.findByRole("heading", { name: "Canvasses" })).toBeInTheDocument();
    expect(screen.queryByText("Home")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /create purchase request/i })).not.toBeInTheDocument();
  });

  it("shows a reader no row checkboxes even when subject-less Canvasses exist", async () => {
    mockUser.current = makeEmployee({ name: "Ana Reyes", has_purchasing_flow: false });
    stubCanvassMoneyRpc({ money: false });
    stubCanvassWinnerRpcs({ bands: [] });
    stubCanvassListRpcs({ actorId: mockUser.current.id });
    const free = db.seed("sor_canvasses", { number: "CNV_0009", product_name: "Gloves", canvasser_id: mockUser.current.id, created_by: mockUser.current.id });
    db.seed("sor_canvass_offers", { canvass_id: free.id, supplier_name: "Glove Co", brand: "Ansell", is_winner: true });
    renderAt("/purchasing/canvasses");
    expect(await screen.findAllByTestId("canvass-row")).not.toHaveLength(0);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("opens a draft for an item that has no Canvass yet, creating nothing", async () => {
    mockUser.current = makeEmployee({ name: "Marco Dizon", has_purchasing_flow: true });
    stubCanvassMoneyRpc({ money: true });
    stubCanvassWinnerRpcs({ bands: ["purchasing"] });
    stubCanvassListRpcs({ actorId: mockUser.current.id });
    renderAt("/purchasing/canvasses?item=22222222-2222-4222-8222-222222222222");
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(db.rows("sor_canvasses")).toHaveLength(0);
  });
});
