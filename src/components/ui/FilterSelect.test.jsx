import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { setupUser } from "@/test/support";
import { FilterSelect } from "./FilterDropdown";

const options = [
  { value: "ALL", label: "All statuses" },
  { value: "DONE", label: "Done" },
];

describe("FilterSelect", () => {
  it("shows the chosen option and reports a new pick", async () => {
    const user = setupUser();
    const onChange = vi.fn();
    render(<FilterSelect label="Status" options={options} value="ALL" onChange={onChange} />);

    await user.click(screen.getByText("All statuses"));
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(onChange).toHaveBeenCalledWith("DONE");
  });

  it("does not open when disabled", async () => {
    const user = setupUser();
    render(<FilterSelect label="Status" options={options} value="ALL" onChange={() => {}} disabled />);

    await user.click(screen.getByText("All statuses"));
    expect(screen.queryByRole("button", { name: "Done" })).not.toBeInTheDocument();
  });
});
