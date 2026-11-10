import { describe, it, expect, vi } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";

import { useCostingWrites } from "./useCostingWrites";
import { costingKeys } from "./costingKeys";

/**
 * A sheet write refreshes the S0 Evaluation list too (#892). The list sits behind the sheet and
 * shows the same Planned and Actual Revenue, so a write that only refetched the SOR's own queries
 * left the list showing the figures from before the edit.
 */
function Harness({ listFn, onReady }) {
  const { data } = useQuery({ queryKey: costingKeys.matrixPage, queryFn: listFn, staleTime: Infinity });
  onReady(useCostingWrites("opp-1"));
  return <p>{data ?? "loading"}</p>;
}

describe("useCostingWrites refresh", () => {
  it("refetches the S0 Evaluation list along with the open SOR's matrix", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const listFn = vi.fn(async () => "rows");
    let writes;
    render(
      <QueryClientProvider client={client}>
        <Harness listFn={listFn} onReady={(w) => (writes = w)} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(listFn).toHaveBeenCalledTimes(1));

    await act(() => writes.refresh());

    expect(listFn).toHaveBeenCalledTimes(2);
  });
});
