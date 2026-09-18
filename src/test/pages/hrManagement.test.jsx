import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import EmployeeManagement from "@/pages/hr/management/index";
import { renderWithProviders, setupUser } from "@/test/support";
import { makeEmployee, makeHrEmployee } from "@/test/factories";

const mockUser = vi.hoisted(() => ({ current: null }));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    user: mockUser.current,
    isAuthLoading: false,
  }),
}));

describe("EmployeeManagement", () => {
  beforeEach(() => {
    mockUser.current = makeHrEmployee({ name: "HR Admin" });
  });

  it("filters the table by the Leave Manager role flag and ensures Standard excludes them", async () => {
    const user = setupUser();

    // 1. Create employees with different roles
    makeEmployee({ name: "Leave Boss", can_manage_leaves: true });
    makeEmployee({ name: "Standard Worker" }); // can_manage_leaves defaults to false

    renderWithProviders(
      <MemoryRouter>
        <EmployeeManagement />
      </MemoryRouter>
    );

    // Initial state: both should be visible
    await waitFor(() => {
      expect(screen.getByText("Leave Boss")).toBeInTheDocument();
      expect(screen.getByText("Standard Worker")).toBeInTheDocument();
    });

    // Open the filter dropdown for Role Flag
    const addFilterBtn = await screen.findByRole("button", { name: /Add Filter/i });
    await user.click(addFilterBtn);

    const flagsDropdown = await screen.findByText("All Flags");
    await user.click(flagsDropdown);

    // Select "Leave Manager"
    const leaveManagerOption = await screen.findByRole("button", { name: "Leave Manager" });
    await user.click(leaveManagerOption);

    // Verify only the Leave Manager is shown
    await waitFor(() => {
      expect(screen.getByText("Leave Boss")).toBeInTheDocument();
      expect(screen.queryByText("Standard Worker")).not.toBeInTheDocument();
    });

    // Now switch to "Standard"
    const currentFlagDropdown = await screen.findByText("Leave Manager");
    await user.click(currentFlagDropdown);

    const standardOption = await screen.findByRole("button", { name: "Standard" });
    await user.click(standardOption);

    // Verify only the Standard Worker is shown (Leave Boss is excluded)
    await waitFor(() => {
      expect(screen.getByText("Standard Worker")).toBeInTheDocument();
      expect(screen.queryByText("Leave Boss")).not.toBeInTheDocument();
    });
  });

  it("applies the SIL auto-grant to the input field on promotion and correctly handles edited balances", async () => {
    const user = setupUser();

    makeEmployee({ name: "Probationary Worker", employment_status: "Probationary", sil_hours_balance: 5 });

    renderWithProviders(
      <MemoryRouter>
        <EmployeeManagement />
      </MemoryRouter>
    );

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByText("Probationary Worker")).toBeInTheDocument();
    });

    // Click edit on the employee
    const row = screen.getByText("Probationary Worker").closest("tr");
    const editBtn = within(row).getByTitle("Edit Employee");
    await user.click(editBtn);

    // Form modal opens
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    // Initial SIL balance should be 5
    const silInput = screen.getByRole("spinbutton", { name: /SIL Hours Balance/i });
    expect(silInput).toHaveValue(5);

    // Change status to Regular
    const modal = screen.getByRole("dialog");
    const statusDropdown = await within(modal).findByRole("button", { name: "Probationary" });
    await user.click(statusDropdown);
    const regularOption = await screen.findByRole("button", { name: "Regular" });
    await user.click(regularOption);

    // SIL balance should automatically increase by 40 to 45
    expect(silInput).toHaveValue(45);
    expect(screen.getByText("+40 hrs auto-granted")).toBeInTheDocument();

    // Type a new value, e.g., 50 (simulate HR modifying the balance after grant)
    await user.clear(silInput);
    await user.type(silInput, "50");
    expect(silInput).toHaveValue(50);

    // Toggle back to Probationary
    const newStatusDropdown = await within(modal).findByRole("button", { name: "Regular" });
    await user.click(newStatusDropdown);
    const probOption = await screen.findByRole("button", { name: "Probationary" });
    await user.click(probOption);

    // SIL balance should decrease by 40 to 10
    expect(silInput).toHaveValue(10);
    expect(screen.queryByText("+40 hrs auto-granted")).not.toBeInTheDocument();

    // Toggle to Regular again
    const finalStatusDropdown = await within(modal).findByRole("button", { name: "Probationary" });
    await user.click(finalStatusDropdown);
    const finalRegularOption = await screen.findByRole("button", { name: "Regular" });
    await user.click(finalRegularOption);

    // SIL balance should increase by 40 to 50 again
    expect(silInput).toHaveValue(50);
    expect(screen.getByText("+40 hrs auto-granted")).toBeInTheDocument();

    // Save
    const saveBtn = screen.getByRole("button", { name: "Update Employee" });
    await user.click(saveBtn);

    // Wait for the modal to close and success toast
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    // Ensure SIL is displayed correctly on the table for the employee
    const silCellText = screen.getByText((content, element) => {
      return element.tagName.toLowerCase() === 'span' && content === '50h';
    });
    expect(silCellText).toBeInTheDocument();
  });
});
