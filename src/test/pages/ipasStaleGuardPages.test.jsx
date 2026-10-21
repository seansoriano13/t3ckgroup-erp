import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import IpasDetailPage from "@/pages/purchasing/ipas/[id]";
import { supabase } from "@/lib/supabase";
import { renderWithProviders, setupUser } from "@/test/support";
import { makeEmployee } from "@/test/factories";
import { db } from "@/test/db/store";
import { stubIpasRpcs } from "@/test/stubs/ipasRpc";

const mockUser = vi.hoisted(() => ({ current: null }));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser.current, isAuthLoading: false }),
}));

/**
 * The IPAS long form against two people editing at once (#581 follow-up): a notice when
 * somebody else changes the IPAS, and Save all refusing when someone else saved first.
 */

function seedIpas() {
  const row = db.seed("ipas", {
    number: "TGIPAS_049",
    po_number: "P02552",
    priority: "high",
    source: "local",
    purpose: "inventory",
    odoo_copy: {
      po: { id: 1, name: "P02552", state: "purchase", company: "T3ck Trading", company_id: 1, currency: "Php", origin: null, partner_ref: null },
      supplier: { id: 5, name: "Scorpe Technologies", contact: "Ms. K. Tan" },
      lines: [{ line_id: 11, name: "Cutter", brand: "SCORPE", quantity: 6, unit: "Unit", price_unit: 1250, price_subtotal: 7500, taxes: [], analytic: [] }],
      receipts: { status: "pending", done: 0, total: 1 },
      bills: { count: 0, draft: 0 },
    },
    odoo_fetched_at: "2026-10-13T02:00:00.000Z",
    state: "open",
    created_by: mockUser.current.id,
  });
  db.seed("ipas_events", { ipas_id: row.id, actor_id: mockUser.current.id, kind: "raised", detail: {}, created_at: "2026-10-13T02:00:00.000Z" });
  return row;
}

function renderEdit(id) {
  return renderWithProviders(
    <MemoryRouter initialEntries={[`/purchasing/ipas/${id}?edit=header`]}>
      <Routes>
        <Route path="/purchasing/ipas/:id" element={<IpasDetailPage />} />
        <Route path="/purchasing/ipas" element={<p>The IPAS list</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("IPAS long form, two people at once", () => {
  let purchaser, other, handlers, removed;

  beforeEach(() => {
    purchaser = makeEmployee({ name: "Buyer", has_purchasing_flow: true });
    other = makeEmployee({ name: "Sam Reyes", has_purchasing_flow: true });
    mockUser.current = purchaser;
    stubIpasRpcs({ actorId: purchaser.id });
    handlers = [];
    removed = vi.fn();
    vi.spyOn(supabase, "channel").mockImplementation(() => {
      const channel = {
        on: (_type, _filter, callback) => {
          handlers.push(callback);
          return channel;
        },
        subscribe: () => channel,
      };
      return channel;
    });
    vi.spyOn(supabase, "removeChannel").mockImplementation(removed);
  });

  it("says who updated the IPAS, keeps what is typed, and ignores the user's own changes", async () => {
    const row = seedIpas();
    const user = setupUser();
    const view = renderEdit(row.id);

    const remarks = await screen.findByRole("textbox", { name: /^Remarks/ });
    await user.type(remarks, "Rush order");
    await waitFor(() => expect(handlers.length).toBeGreaterThan(0));

    await act(async () => {
      handlers.forEach((fn) => fn({ new: { actor_id: purchaser.id, ipas_id: row.id } }));
    });
    expect(screen.queryByText(/updated this IPAS/)).not.toBeInTheDocument();

    await act(async () => {
      handlers.forEach((fn) => fn({ new: { actor_id: other.id, ipas_id: row.id } }));
    });
    expect(await screen.findByText("Sam Reyes updated this IPAS. Reload to see the changes.")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /^Remarks/ })).toHaveValue("Rush order");

    view.unmount();
    expect(removed).toHaveBeenCalled();
  });

  it("refuses Save all when someone else saved since the form loaded, and keeps the typing", async () => {
    const row = seedIpas();
    const user = setupUser();
    renderEdit(row.id);

    const remarks = await screen.findByRole("textbox", { name: /^Remarks/ });
    await user.type(remarks, "Rush order");
    db.seed("ipas_events", { ipas_id: row.id, actor_id: other.id, kind: "header_changed", detail: {}, created_at: "2026-10-14T02:00:00.000Z" });

    await user.click(screen.getByRole("button", { name: /^Save all/ }));

    expect((await screen.findAllByText(/someone else saved this IPAS/i)).length).toBeGreaterThan(0);
    expect(db.rows("ipas")[0].remarks ?? null).toBeNull();
    expect(screen.getByRole("textbox", { name: /^Remarks/ })).toHaveValue("Rush order");
  });

  it("#585: Save all is not refused when the Odoo refresh landed after the form loaded", async () => {
    const row = seedIpas();
    const user = setupUser();
    renderEdit(row.id);

    const remarks = await screen.findByRole("textbox", { name: /^Remarks/ });
    await user.type(remarks, "Rush order");
    // The refresh from Odoo commits its event in the viewer's name before the page reloads it.
    db.seed("ipas_events", { ipas_id: row.id, actor_id: purchaser.id, kind: "odoo_copy_changed", detail: {}, created_at: "2026-10-14T02:00:00.000Z" });
    db.seed("ipas_events", { ipas_id: row.id, actor_id: other.id, kind: "approvals_cleared", detail: { reason: "PO changed in Odoo", sections: [] }, created_at: "2026-10-14T02:00:01.000Z" });

    await user.click(screen.getByRole("button", { name: /^Save all/ }));

    await waitFor(() => expect(db.rows("ipas")[0].remarks).toBe("Rush order"));
    expect(screen.queryByText(/someone else saved this IPAS/i)).not.toBeInTheDocument();
  });

  it("#585: another person's Odoo refresh does not raise the 'updated this IPAS' notice", async () => {
    const row = seedIpas();
    const user = setupUser();
    renderEdit(row.id);

    await user.type(await screen.findByRole("textbox", { name: /^Remarks/ }), "Rush order");
    await waitFor(() => expect(handlers.length).toBeGreaterThan(0));
    await act(async () => {
      handlers.forEach((fn) => fn({ new: { actor_id: other.id, ipas_id: row.id, kind: "odoo_copy_changed" } }));
    });
    expect(screen.queryByText(/updated this IPAS/)).not.toBeInTheDocument();
  });

  it("saves normally when nobody else did, including its own later steps", async () => {
    const row = seedIpas();
    const user = setupUser();
    renderEdit(row.id);

    await user.type(await screen.findByRole("textbox", { name: /^Remarks/ }), "Rush order");
    await user.click(screen.getByRole("button", { name: /^Save all/ }));

    await waitFor(() => expect(db.rows("ipas")[0].remarks).toBe("Rush order"));
    expect(await screen.findByText("All changes saved")).toBeInTheDocument();
  });
});
