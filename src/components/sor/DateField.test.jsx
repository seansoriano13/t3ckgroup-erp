/**
 * SOR date fields read "Nov 5, 2026" like the lists. A native date input showed
 * the browser's own order (11/05/2026), which read as the wrong day to a
 * Philippine user. The stored value stays "YYYY-MM-DD".
 */
import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "../../test/support";
import { DateField } from "./SorField";
import { formatSorDate } from "../../utils/sorDate";

describe("formatSorDate", () => {
  it("reads a stored date as Month day, year", () => {
    expect(formatSorDate("2026-11-05")).toBe("Nov 5, 2026");
  });

  it("is empty when there is no date", () => {
    expect(formatSorDate("")).toBe("");
    expect(formatSorDate(null)).toBe("");
  });
});

describe("DateField", () => {
  it("shows the date in the SOR format and a placeholder when empty", () => {
    const { unmount } = renderWithProviders(
      <DateField label="Expected Award Date" value="2026-11-05" onChange={() => {}} />,
    );
    expect(screen.getByText("Nov 5, 2026")).toBeInTheDocument();
    unmount();

    renderWithProviders(<DateField label="Expected Award Date" value="" onChange={() => {}} />);
    expect(screen.getByText("Select date…")).toBeInTheDocument();
  });

  it("reports a picked day as YYYY-MM-DD", () => {
    const onChange = vi.fn();
    renderWithProviders(
      <DateField label="Expected Award Date" value="2026-11-05" onChange={onChange} />,
    );

    fireEvent.click(screen.getByText("Nov 5, 2026"));
    fireEvent.click(screen.getByLabelText(/November 12th, 2026/));

    expect(onChange).toHaveBeenCalledWith({ target: { value: "2026-11-12" } });
  });

  it("does not open when disabled", () => {
    renderWithProviders(
      <DateField label="Registration Date" disabled value="2026-11-05" onChange={() => {}} />,
    );

    fireEvent.click(screen.getByText("Nov 5, 2026"));

    expect(screen.queryByLabelText(/November 12th, 2026/)).not.toBeInTheDocument();
  });
});
