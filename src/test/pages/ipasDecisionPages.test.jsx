import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import IpasDetailPage from "@/pages/purchasing/ipas/[id]";
import { renderWithProviders, setupUser } from "@/test/support";
import { makeEmployee } from "@/test/factories";
import { db } from "@/test/db/store";
import { stubEdgeFunction } from "@/test/msw/server";
import { seedIpasOptions, stubIpasRpcs } from "@/test/stubs/ipasRpc";
import { makeReady } from "@/test/support/ipasReady";
import { findOtherDialog } from "@/test/support/dialogs";

const mockUser = vi.hoisted(() => ({ current: null }));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser.current, isAuthLoading: false }),
}));

/**
 * The rail ("Your move") as the people at the screen meet it: one road in two
 * stretches. "1. Get it ready" is a checklist of the work, each item naming who does
 * it; "2. Sign the final IPAS" opens once all of it is done. The headline says whose
 * turn it is, and a person sees a button only on the items that are theirs.
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
    matches: wide && !/max-/.test(query),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

const item = (region, key) => within(region).getByTestId(`ipas-journey-${key}`);

describe("IPAS rail: Your move and the filed state", () => {
  let purchaser, approver, other, superAdmin;
  const originalMatchMedia = window.matchMedia;

  const signIn = (person, opts = {}) => {
    mockUser.current = person;
    stubIpasRpcs({ actorId: person.id, purchasing: Boolean(person.has_purchasing_flow), ...opts });
  };

  /** A ready IPAS: files attached, Landed Cost final, Logistics signed. */
  const readyIpas = (overrides = {}) => {
    const row = ipas({ computation_status: "lc_odoo_done", ...overrides });
    makeReady(row, approver);
    return row;
  };
  const sentByPurchaser = (row) => {
    signoff(row.id, 1, "prepared", purchaser);
    signoff(row.id, 3, "prepared", purchaser);
    signoff(row.id, 6, "prepared", purchaser);
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

  it("names the region and tells the purchaser it is their turn, with a button on each item that is theirs", async () => {
    const row = ipas();
    renderDetail(row.id);

    const region = await screen.findByRole("region", { name: "Your move" });
    expect(within(region).getByRole("heading", { name: "Your move" })).toBeInTheDocument();
    expect(within(region).getByTestId("ipas-journey-headline")).toHaveTextContent("Your turn: Attach the files.");
    expect(within(region).getByRole("heading", { name: /^1\. Get it ready/ })).toHaveTextContent("3 of 8 done");

    expect(within(item(region, "files")).getByRole("button", { name: "Attach in 5 · Documents" })).toBeInTheDocument();
    expect(within(item(region, "location")).getByRole("button", { name: "Pick it in 4 · Delivery" })).toBeInTheDocument();
    expect(within(item(region, "transmittal")).getByRole("button", { name: "Raise a Transmittal" })).toBeInTheDocument();
    expect(within(item(region, "landed")).getByRole("button", { name: "Mark Landed Cost final" })).toBeInTheDocument();
    // Every item says who does it; the charges item has nothing left to do.
    expect(item(region, "files")).toHaveTextContent("Who: Purchasing");
    expect(item(region, "charges")).toHaveTextContent("done");
    // Signing is not open yet, and nothing in it is offered.
    expect(within(region).getByText(/Opens once everything in 1 is done/)).toBeInTheDocument();
    expect(within(region).queryByRole("button", { name: /^Review and/ })).not.toBeInTheDocument();
    expect(within(region).queryByRole("button", { name: "Send back…" })).not.toBeInTheDocument();
  });

  it("opens the section an item points to, ready for typing", async () => {
    const user = setupUser();
    const row = ipas();
    renderDetail(row.id);

    const region = await screen.findByRole("region", { name: "Your move" });
    await user.click(within(item(region, "location")).getByRole("button", { name: "Pick it in 4 · Delivery" }));

    expect(await screen.findByRole("button", { name: /^Save all/ })).toBeDisabled();
  });

  it("marks Landed Cost final from its item, in one click", async () => {
    const row = ipas({ computation_status: "lc_gs_done" });
    const user = setupUser();
    renderDetail(row.id);

    const region = await screen.findByRole("region", { name: "Your move" });
    await user.click(within(item(region, "landed")).getByRole("button", { name: "Mark Landed Cost final" }));

    await waitFor(() => expect(db.rows("ipas")[0].computation_status).toBe("lc_odoo_done"));
  });

  it("folds the finished checklist away, and shows it again on request", async () => {
    const row = readyIpas();
    const user = setupUser();
    renderDetail(row.id);

    const region = await screen.findByRole("region", { name: "Your move" });
    expect(within(region).getByRole("heading", { name: /^1\. Get it ready/ })).toHaveTextContent("8 of 8 done");
    expect(within(region).queryByTestId("ipas-journey-files")).not.toBeInTheDocument();
    await user.click(within(region).getByRole("button", { name: "Show what was done" }));
    expect(item(region, "files")).toHaveTextContent("done");
    expect(item(region, "logistics")).toHaveTextContent("Signed by Boss Lito.");
  });

  it("lists Logistics as the first row of section 6, and section 4 has no sign button", async () => {
    const row = readyIpas();
    const user = setupUser();
    renderDetail(row.id);

    await screen.findByRole("region", { name: "Your move" });
    await user.click(screen.getByRole("button", { name: /^6 · Sign-offs/ }));
    expect(screen.queryByTestId("ipas-logistics-signoff")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign Logistics" })).not.toBeInTheDocument();
    const rows = document.querySelectorAll('li[id^="ipas-signoff-"]');
    expect(rows[0]).toHaveAttribute("id", "ipas-signoff-logistics");
    expect(rows[0]).toHaveTextContent("Signed by Boss Lito.");
  });

  it("opens signing once everything is ready, with Send for signing as the purchaser's turn", async () => {
    const row = readyIpas();
    renderDetail(row.id);

    const region = await screen.findByRole("region", { name: "Your move" });
    expect(within(region).getByTestId("ipas-journey-headline")).toHaveTextContent("Your turn: Send for signing.");
    expect(within(item(region, "send")).getByRole("button", { name: "Go to sign-off" })).toBeInTheDocument();
    // The later steps wait, and say who they wait on.
    expect(item(region, "approve")).toHaveTextContent("Who: Boss Lito");
    expect(item(region, "check")).toHaveTextContent("Nobody is on the Received, Noted and Checked list yet");
    expect(within(item(region, "approve")).queryByRole("button")).not.toBeInTheDocument();
  });

  it("points the rail to the sign-off row, and Sign on the row opens the review", async () => {
    const row = readyIpas();
    const user = setupUser();
    renderDetail(row.id);

    const region = await screen.findByRole("region", { name: "Your move" });
    await user.click(within(item(region, "send")).getByRole("button", { name: "Go to sign-off" }));

    // Section 6 opens, and the row is marked for a moment.
    const target = await waitFor(() => {
      const found = document.getElementById("ipas-signoff-send");
      expect(found).not.toBeNull();
      return found;
    });
    await waitFor(() => expect(target).toHaveAttribute("data-highlighted", "true"));
    // Nothing signed yet; the row's Sign opens the review window.
    expect(screen.queryByRole("button", { name: "Send for signing" })).not.toBeInTheDocument();
    await user.click(within(target).getByRole("button", { name: "Sign" }));
    expect(await screen.findByRole("button", { name: "Send for signing" })).toBeInTheDocument();
  });

  it("says who sent it and that it is approved, once the signatures are in", async () => {
    const row = readyIpas();
    sentByPurchaser(row);
    signoff(row.id, 1, "approved", approver);
    signoff(row.id, 3, "approved", approver);
    signoff(row.id, 6, "approved", approver);
    renderDetail(row.id);

    const region = await screen.findByRole("region", { name: "Your move" });
    expect(item(region, "send")).toHaveTextContent("Sent by Buyer.");
    expect(item(region, "approve")).toHaveTextContent("Approved.");
    expect(item(region, "check")).toHaveTextContent("waiting");
  });

  it("offers an approver Review and approve and Send back, never a Purchasing move", async () => {
    const row = readyIpas();
    sentByPurchaser(row);
    signIn(approver);
    renderDetail(row.id);

    const region = await screen.findByRole("region", { name: "Your move" });
    expect(within(region).getByTestId("ipas-journey-headline")).toHaveTextContent("Your turn: Approve.");
    expect(within(item(region, "approve")).getByRole("button", { name: "Go to sign-off" })).toBeInTheDocument();
    expect(within(region).getByRole("button", { name: "Send back…" })).toBeInTheDocument();
    expect(within(item(region, "send")).queryByRole("button", { name: "Go to sign-off" })).not.toBeInTheDocument();
    expect(within(region).queryByRole("button", { name: /^Mark Landed/ })).not.toBeInTheDocument();
  });

  it("tells a preparer that someone else approves what they sent", async () => {
    const row = readyIpas();
    signoff(row.id, 1, "prepared", approver);
    signoff(row.id, 3, "prepared", approver);
    signoff(row.id, 6, "prepared", approver);
    signIn(approver);
    renderDetail(row.id);

    const region = await screen.findByRole("region", { name: "Your move" });
    expect(item(region, "approve")).toHaveTextContent("Boss Lito sent it, so someone else on the list approves it.");
    expect(within(item(region, "approve")).queryByRole("button")).not.toBeInTheDocument();
    expect(within(region).getByTestId("ipas-journey-headline")).not.toHaveTextContent(/^Your turn/);
  });

  it("says nothing is the viewer's turn, and names who the IPAS waits on", async () => {
    const row = ipas();
    signIn(other);
    renderDetail(row.id);

    const region = await screen.findByRole("region", { name: "Your move" });
    expect(within(region).getByTestId("ipas-journey-headline")).toHaveTextContent("Getting it ready. Waiting on Purchasing: Attach the files.");
    expect(within(region).queryAllByRole("button").filter((b) => /^(Attach|Pick|Mark|Review)/.test(b.textContent))).toHaveLength(0);
    expect(within(region).queryByRole("button", { name: "Raise a Transmittal" })).not.toBeInTheDocument();
  });

  it("names the approvers as the wait once the purchaser has sent it", async () => {
    const row = readyIpas();
    sentByPurchaser(row);
    renderDetail(row.id);

    const region = await screen.findByRole("region", { name: "Your move" });
    expect(within(region).getByTestId("ipas-journey-headline")).toHaveTextContent("Waiting on Boss Lito: Approve.");
  });

  it("says why Logistics cannot be signed yet, and what it opens on", async () => {
    const row = ipas();
    signIn(other);
    renderDetail(row.id);

    const region = await screen.findByRole("region", { name: "Your move" });
    expect(item(region, "logistics")).toHaveTextContent(/Opens once the Item Location and Transmittal are in\./);
  });

  it("says Filed, with no moves; Reopen sits in the filed banner and only a Super Admin gets it", async () => {
    const row = ipas({ state: "filed", filed_at: "2026-10-14T00:00:00.000Z", computation_status: "lc_odoo_done" });
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
    expect(within(region).queryAllByRole("button")).toHaveLength(0);
    expect(within(screen.getByTestId("ipas-filed-notice")).queryByRole("button", { name: "Reopen" })).not.toBeInTheDocument();
    unmount();

    signIn(superAdmin, { superAdmin: true });
    renderDetail(row.id);
    const region2 = await screen.findByRole("region", { name: "Your move" });
    expect(within(region2).queryByRole("button", { name: "Reopen" })).not.toBeInTheDocument();
    const user = setupUser();
    await user.click(within(await screen.findByTestId("ipas-filed-notice")).getByRole("button", { name: "Reopen" }));
    const dialog = await findOtherDialog();
    expect(within(dialog).getByPlaceholderText("Why is this filed IPAS being reopened?")).toBeInTheDocument();
  });

  it("puts Your move behind a button when the window is narrow", async () => {
    stubWide(false);
    const user = setupUser();
    const row = ipas();
    renderDetail(row.id);

    await screen.findByRole("heading", { name: "Sections" });
    // Narrow, the card is a "Your move" button above the sections that opens it in a drawer.
    await user.click(await screen.findByRole("button", { name: "Your move" }));
    // The checklist and its buttons are there at any width.
    expect(await screen.findByRole("button", { name: "Mark Landed Cost final" })).toBeInTheDocument();
  });
});
