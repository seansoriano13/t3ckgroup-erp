import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { usePagedChat } from "./usePagedChat";

const msg = (n) => ({ id: `m${n}`, created_at: `2026-01-01T00:00:${String(n).padStart(2, "0")}Z` });
const all = Array.from({ length: 5 }, (_, i) => msg(i + 1));

// Same contract as the services: newest `limit` older than `before`, oldest first.
const fetchPage = vi.fn(async ({ before, limit }) =>
  all.filter((m) => !before || m.created_at < before).slice(-limit),
);

const wrapper = ({ children }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

describe("usePagedChat", () => {
  it("loads the newest page, then older pages oldest-first on demand", async () => {
    const { result } = renderHook(
      () => usePagedChat({ queryKey: ["t"], fetchPage, pageSize: 2 }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.messages.map((m) => m.id)).toEqual(["m4", "m5"]));
    expect(result.current.hasMore).toBe(true);

    await act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.messages.map((m) => m.id)).toEqual(["m2", "m3", "m4", "m5"]));

    await act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.messages).toHaveLength(5));
    expect(result.current.hasMore).toBe(false);
  });
});
