import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TablePager } from "./TablePager";

const props = { total: 60, page: 2, pageSize: 25, totalPages: 3, setPage: vi.fn(), setPageSize: vi.fn(), noun: "tasks" };

describe("TablePager", () => {
  it("reports the visible range and total", () => {
    render(<TablePager {...props} />);
    expect(screen.getByText(/Showing/).textContent).toBe("Showing 26 to 50 of 60 tasks");
    expect(screen.getByText("Page 2 of 3")).toBeInTheDocument();
  });

  it("steps to the previous and next page", async () => {
    const setPage = vi.fn();
    render(<TablePager {...props} setPage={setPage} />);
    await userEvent.click(screen.getByRole("button", { name: /next page/i }));
    expect(setPage).toHaveBeenLastCalledWith(3);
    await userEvent.click(screen.getByRole("button", { name: /previous page/i }));
    expect(setPage).toHaveBeenLastCalledWith(1);
  });

  it("disables Previous on the first page and Next on the last", () => {
    const { rerender } = render(<TablePager {...props} page={1} />);
    expect(screen.getByRole("button", { name: /previous page/i })).toBeDisabled();
    rerender(<TablePager {...props} page={3} />);
    expect(screen.getByRole("button", { name: /next page/i })).toBeDisabled();
  });

  it("hides the page controls when everything fits on one page", () => {
    render(<TablePager {...props} total={5} page={1} totalPages={1} />);
    expect(screen.queryByRole("button", { name: /next page/i })).not.toBeInTheDocument();
    expect(screen.getByText(/Showing/).textContent).toBe("Showing 1 to 5 of 5 tasks");
  });
});
