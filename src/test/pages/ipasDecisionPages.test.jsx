import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import IpasDetailPage from "@/pages/purchasing/ipas/[id]";
import { renderWithProviders } from "@/test/support";
import { makeEmployee } from "@/test/factories";
import { db } from "@/test/db/store";
import { stubEdgeFunction } from "@/test/msw/server";
import { seedIpasOptions, stubIpasRpcs } from "@/test/stubs/ipasRpc";

const mockUser = vi.hoisted(() => ({ current: null }));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser.current, isAuthLoading: false }),
}));

/**
 * The decider (#531) as the people at the screen meet it: "Your move" offers
 * only what the person may do, says what happens next, and the chain names
 * each gate by section and role with exactly one Now. Below the wide
 * breakpoint the sections come first and the chain sits behind a toggle.
 */

const poCopy = (po) => ({
  po: { id: 1, name: po, state: "purchase", company: "T3ck Trading", company_id: 1, currency: "Php", origin: null, partner_ref: null },
  supplier: { id: 5, name: "Scorpe Technologies", contact: "Ms. K. Tan" },
  lines: [
    { line_id: 11, name: "Greenspirit 2 Cutter", brand: "SCORPE", quantity: 6, unit: "Unit", price_unit: 1250, price_subtotal: 7500, taxes: [], analytic: [] },
  ],
  receipts: { status: "pending", done: 0, total: 1 },
  bills: { count: 0, draft: 0 },
});

let counter = 60;
function ipas(overrides = {}) {
  counter += 1;
  const po = overrides.po_number ?? `P0${3500 + counter}`;
  return db.seed("ipas", {
    number: `TGIPAS_${String(counter).padStart(3, "0")}`,
    po_number: po,
    priority: "high",
    source: "local",
    purpose: "inventory",
    odoo_copy: poCopy(po),
    odoo_fetched_at: "2026-10-13T02:00:00.000Z",
    state: "open",
    landed_cost_split: "value",
    computation_status: "encoding",
    ...overrides,
  });
}

const signoff = (ipasId, section, role, signedBy, over = {}) =>
  db.seed("ipas_signoffs", { ipas_id: ipasId, section, role, signed_by: signedBy.id, signed_at: "2026-09-05T06:40:00.000Z", ...over });
const onList = (listKey, ...people) => people.forEach((p) => db.seed("ipas_signer_lists", { list_key: listKey, employee_id: p.id }));

function renderDetail(id) {
  return renderWithProviders(
    <MemoryRouter initialEntries={[`/purchasing/ipas/${id}`]}>
      <Routes>
        <Route path="/purchasing/ipas/:id" element={<IpasDetailPage />} />
        <Route path="/purchasing/ipas" element={<p>The IPAS list</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Stubs the wide breakpoint (xl, 1280px) on or off. jsdom reports no match by default. */
function stubWide(wide) {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: wide,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

const groupsNow = () => screen.getAllByRole("group").filter((group) => /, now$/.test(group.getAttribute("aria-label") ?? ""));

describe("IPAS decider: Your move, the chain and the filed state", () => {
  let purchaser, approver, other, superAdmin;
  const originalMatchMedia = window.matchMedia;

  const signIn = (person, opts = {}) => {
    mockUser.current = person;
    stubIpasRpcs({ actorId: person.id, purchasing: Boolean(person.has_purchasing_flow), ...opts });
  };

  beforeEach(() => {
    counter = 60;
    stubWide(true);
    purchaser = makeEmployee({ name: "Buyer", has_purchasing_flow: true });
    approver = makeEmployee({ name: "Boss Lito" });
    other = makeEmployee({ name: "Co Approver" });
    superAdmin = makeEmployee({ name: "Super Admin", is_super_admin: true });
    seedIpasOptions((table, row) => db.seed(table, row));
    onList("s1_approved", approver);
    onList("s3_approved", approver);
    signIn(purchaser);
    stubEdgeFunction("odoo-po-ipas", (body) => ({ success: true, found: true, ...poCopy(body.poNumber) }));
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it("names the card region and offers the purchaser the moves allowed to them, each with its hint", async () => {
    const row = ipas();
    renderDetail(row.id);

    const region = await screen.findByRole("region", { name: "Your move" });
    expect(within(region).getByRole("heading", { name: "Your move" })).toBeInTheDocument();

    expect(within(region).getByRole("button", { name: "Prepare section 1 · Purchasing" })).toBeInTheDocument();
    expect(within(region).getByRole("button", { name: "Prepare section 2 · Purchasing & Finance" })).toBeInTheDocument();
    expect(within(region).queryByRole("button", { name: /^Approve/ })).not.toBeInTheDocument();
    expect(within(region).queryByRole("button", { name: /Send section/ })).not.toBeInTheDocument();
    expect(within(region).queryByRole("button", { name: "Reopen this IPAS" })).not.toBeInTheDocument();

    expect(
      within(region).getByText("Marks section 1 · Purchasing ready to approve. Nothing locks. Next: the approvers of 1 · Purchasing, told now."),
    ).toBeInTheDocument();
    expect(within(region).getByText("Next: Waiting for you")).toBeInTheDocument();
  });

  it("keeps Mark costs complete in its own group below the sign-offs, with a divider", async () => {
    const row = ipas({ computation_status: "encoded" });
    signoff(row.id, 1, "prepared", purchaser);
    signoff(row.id, 1, "approved", approver);
    renderDetail(row.id);

    const region = await screen.findByRole("region", { name: "Your move" });
    const costs = within(region).getByRole("button", { name: "Mark costs complete" });
    const group = costs.closest("ul");
    expect(group).toHaveClass("border-t");
    expect(group).not.toBe(within(region).getByRole("button", { name: "Prepare section 2 · Purchasing & Finance" }).closest("ul"));
    expect(within(region).getByText(/Makes Landed Cost final/)).toBeInTheDocument();
  });

  it("names the gates by section and role, and marks exactly one Now (encoding, sections 1 and 2 approved: Received)", async () => {
    const row = ipas({ computation_status: "encoding" });
    signoff(row.id, 1, "prepared", purchaser);
    signoff(row.id, 1, "approved", approver);
    signoff(row.id, 3, "prepared", purchaser);
    signoff(row.id, 3, "approved", approver);
    renderDetail(row.id);

    await screen.findByRole("region", { name: "Your move" });
    expect(screen.getByRole("group", { name: "Section 1, Purchasing, Approved, done" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Section 2, Purchasing & Finance, Approved, done" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Section 3, Computation status & Landed Cost, Costs complete, waiting" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Section 4, Filing, Received, now" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Section 4, Filing, Noted and Checked, waiting" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Section 4, Filing, Approved, waiting" })).toBeInTheDocument();

    const nows = groupsNow();
    expect(nows).toHaveLength(1);
    expect(nows[0]).toHaveAccessibleName("Section 4, Filing, Received, now");
  });

  it("says who approved a gate and when, and keeps Noted and Checked in either order", async () => {
    const row = ipas({ computation_status: "encoding" });
    signoff(row.id, 1, "prepared", purchaser);
    signoff(row.id, 1, "approved", approver, { signed_at: "2026-09-05T06:40:00.000Z" });
    renderDetail(row.id);

    const gate = await screen.findByRole("group", { name: "Section 1, Purchasing, Approved, done" });
    expect(within(gate).getByText(/^Approved by Boss Lito · Sep 5, 2026/)).toBeInTheDocument();
    const notedAndChecked = screen.getByRole("group", { name: "Section 4, Filing, Noted and Checked, waiting" });
    expect(within(notedAndChecked).getByText("Noted and Checked, in either order, after Received")).toBeInTheDocument();
  });

  it("reads the next step to the viewer: Waiting for Finance when the Now gate is Finance's", async () => {
    const row = ipas({ computation_status: "encoding" });
    signoff(row.id, 1, "prepared", purchaser);
    signoff(row.id, 1, "approved", approver);
    signoff(row.id, 3, "prepared", purchaser);
    signoff(row.id, 3, "approved", approver);
    renderDetail(row.id);

    const region = await screen.findByRole("region", { name: "Your move" });
    expect(within(region).getByText("Next: Waiting for Finance")).toBeInTheDocument();
    // The purchaser may still mark costs complete: offered, but not the Now gate.
    expect(within(region).getByRole("button", { name: "Mark costs complete" })).toBeInTheDocument();
  });

  it("offers an approver only Approve and Send back on their section, never a Purchasing move", async () => {
    const row = ipas();
    signoff(row.id, 1, "prepared", purchaser);
    signIn(approver);
    renderDetail(row.id);

    const region = await screen.findByRole("region", { name: "Your move" });
    expect(within(region).getByRole("button", { name: "Approve section 1 · Purchasing" })).toBeInTheDocument();
    expect(within(region).getByRole("button", { name: "Send section 1 · Purchasing back" })).toBeInTheDocument();
    expect(within(region).queryByRole("button", { name: /^Prepare/ })).not.toBeInTheDocument();
    expect(within(region).queryByRole("button", { name: "Mark costs complete" })).not.toBeInTheDocument();
    expect(within(region).queryByRole("button", { name: /Approve section 2/ })).not.toBeInTheDocument();
  });

  it("says nothing needs the viewer, and names the sections it waits on", async () => {
    const row = ipas();
    signIn(other);
    renderDetail(row.id);

    const region = await screen.findByRole("region", { name: "Your move" });
    expect(within(region).getByText("Nothing needs you right now. Waiting on 1 · Purchasing and 2 · Purchasing & Finance.")).toBeInTheDocument();
    expect(within(region).queryByRole("button")).not.toBeInTheDocument();
  });

  it("names Purchasing's encoding as the wait when sections 1 and 2 and the filing steps are given but costs are not encoded", async () => {
    const row = ipas({ computation_status: "encoding" });
    signoff(row.id, 1, "prepared", purchaser);
    signoff(row.id, 1, "approved", approver);
    signoff(row.id, 3, "prepared", purchaser);
    signoff(row.id, 3, "approved", approver);
    signoff(row.id, 7, "received", approver);
    signoff(row.id, 7, "noted", approver);
    signoff(row.id, 7, "checked", approver);
    // Costs are not encoded yet, so Costs complete is not Now and filing waits on it: nothing is Now.
    renderDetail(row.id);

    const region = await screen.findByRole("region", { name: "Your move" });
    expect(within(region).getByText("Waiting for Purchasing to finish encoding costs.")).toBeInTheDocument();
    expect(screen.queryAllByRole("group", { name: /, now$/ })).toHaveLength(0);
  });

  it("says Filed, with no moves; Reopen sits in the filed banner and only a Super Admin gets it", async () => {
    const row = ipas({ state: "filed", filed_at: "2026-10-14T00:00:00.000Z", computation_status: "checked" });
    signoff(row.id, 1, "prepared", purchaser);
    signoff(row.id, 1, "approved", approver);
    signoff(row.id, 3, "prepared", purchaser);
    signoff(row.id, 3, "approved", approver);
    signoff(row.id, 7, "received", approver);
    signoff(row.id, 7, "noted", approver);
    signoff(row.id, 7, "checked", approver);
    signoff(row.id, 7, "approved", approver);
    signIn(purchaser);
    const { unmount } = renderDetail(row.id);

    const region = await screen.findByRole("region", { name: "Your move" });
    expect(within(region).getByText("Filed. Nothing left to do.")).toBeInTheDocument();
    expect(within(region).queryByRole("button")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("ipas-filed-notice")).queryByRole("button", { name: "Reopen" })).not.toBeInTheDocument();
    unmount();

    signIn(superAdmin, { superAdmin: true });
    renderDetail(row.id);
    const region2 = await screen.findByRole("region", { name: "Your move" });
    expect(within(region2).queryByRole("button", { name: "Reopen" })).not.toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(within(await screen.findByTestId("ipas-filed-notice")).getByRole("button", { name: "Reopen" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByPlaceholderText("Why is this filed IPAS being reopened?")).toBeInTheDocument();
  });

  it("below the wide breakpoint, the sections come before the card and the chain sits behind a toggle", async () => {
    stubWide(false);
    const row = ipas();
    renderDetail(row.id);

    const sections = await screen.findByRole("heading", { name: "Sections" });
    const yourMove = screen.getByRole("heading", { name: "Your move" });
    expect(sections.compareDocumentPosition(yourMove) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    expect(screen.queryByRole("group", { name: /^Section 1, Purchasing/ })).not.toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: "Where it stands · 0 of 6" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    const user = userEvent.setup();
    await user.click(toggle);
    expect(screen.getByRole("button", { name: "Hide where it stands" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("group", { name: "Section 1, Purchasing, Approved, now" })).toBeInTheDocument();
  });

  it("keeps the moves visible below the wide breakpoint, collapsed", async () => {
    stubWide(false);
    const row = ipas();
    renderDetail(row.id);

    const region = await screen.findByRole("region", { name: "Your move" });
    expect(within(region).getByRole("button", { name: "Prepare section 1 · Purchasing" })).toBeInTheDocument();
  });
});
