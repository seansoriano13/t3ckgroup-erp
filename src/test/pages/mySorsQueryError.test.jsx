import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";

const getMySors = vi.fn();
vi.mock("../../services/opportunityService", () => ({ opportunityService: { getMySors: (...a) => getMySors(...a) } }));
vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("../../components/ProtectedRoute", () => ({ default: ({ children }) => children }));

import MySors from "../../pages/my-sors/index";

describe("My SORs query failure", () => {
  it("shows the error block (not the empty state) and Retry recovers", async () => {
    getMySors.mockRejectedValueOnce(new Error("boom")).mockResolvedValue([]);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <MySors />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText(/Nobody has called you/)).toBeNull();
    expect(screen.queryByText(/boom/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByText(/Nobody has called you/)).toBeInTheDocument());
  });
});
