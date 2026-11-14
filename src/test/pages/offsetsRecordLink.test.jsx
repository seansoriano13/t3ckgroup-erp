import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import EmployeeLeavesPage from "@/pages/offsets/index";
import { renderWithProviders } from "@/test/support";
import { makeEmployee, makeOffsetLeave } from "@/test/factories";

/**
 * #1015: `/offsets?record=<row id>` (a notification link) shows that request
 * even when it was filed in another month than the one selected; an id that is
 * not an id is not found and sends nothing to the database.
 */

const mockUser = vi.hoisted(() => ({ current: null }));

vi.mock("@/services/calendarService", () => ({
  calendarService: { fetchEntries: vi.fn(async () => []) },
}));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser.current, isAuthLoading: false }),
}));

describe("My Requests ?record=", () => {
  let employee;

  beforeEach(() => {
    employee = makeEmployee({ name: "John Doe" });
    mockUser.current = { id: employee.id, name: employee.name };
  });

  it("opens a decided request filed outside the selected month", async () => {
    const old = makeOffsetLeave({ employee_id: employee.id, date: "2025-01-06", status: "APPROVED" });

    renderWithProviders(
      <MemoryRouter initialEntries={[`/offsets?record=${old.id}`]}>
        <EmployeeLeavesPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/Jan 6/)).toBeInTheDocument();
  });

  it("does not show that request without the link", async () => {
    makeOffsetLeave({ employee_id: employee.id, date: "2025-01-06", status: "APPROVED" });

    renderWithProviders(
      <MemoryRouter initialEntries={["/offsets"]}>
        <EmployeeLeavesPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("No requests found")).toBeInTheDocument();
  });

  it("treats a malformed id as not found", async () => {
    makeOffsetLeave({ employee_id: employee.id, date: "2025-01-06", status: "APPROVED" });

    renderWithProviders(
      <MemoryRouter initialEntries={["/offsets?record=x),id.eq.1"]}>
        <EmployeeLeavesPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText("No requests found")).toBeInTheDocument());
  });
});
