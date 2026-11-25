import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, screen } from "@testing-library/react";
import { onlineManager } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router";
import IpasListPage from "@/pages/purchasing/ipas/index";
import { renderWithProviders } from "@/test/support";
import { makeEmployee } from "@/test/factories";
import { stubIpasRpcs } from "@/test/stubs/ipasRpc";

const mockUser = vi.hoisted(() => ({ current: null }));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser.current, isAuthLoading: false }),
}));

function renderList() {
  return renderWithProviders(
    <MemoryRouter initialEntries={["/purchasing/ipas"]}>
      <Routes>
        <Route path="/purchasing/ipas" element={<IpasListPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

// #1235: a list that has not arrived yet must never read as an empty list.
describe("IPAS list while the list has not arrived (#1235)", () => {
  beforeEach(() => {
    const purchaser = makeEmployee({ name: "Buyer", call_sign: "1001", has_purchasing_flow: true });
    mockUser.current = purchaser;
    stubIpasRpcs({ actorId: purchaser.id });
  });

  afterEach(() => {
    act(() => onlineManager.setOnline(true));
  });

  it("shows loading, not \"No IPAS yet\", while the fetch is paused", async () => {
    // Offline pauses the query the same way a background tab pauses a retry: not loading, not failed.
    onlineManager.setOnline(false);
    renderList();

    expect(await screen.findByText(/Loading IPAS/i)).toBeInTheDocument();
    expect(screen.queryByText("No IPAS yet")).not.toBeInTheDocument();
  });
});
