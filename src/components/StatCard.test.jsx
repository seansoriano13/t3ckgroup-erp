import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import StatCard from "./StatCard";
import { TrendingUp } from "lucide-react";

describe("StatCard", () => {
  it("renders title, value, subtitle and keeps the icon fixed without overflowing on large values", () => {
    const handleClick = vi.fn();
    const { container } = render(
      <StatCard
        title="Commissionable Revenue"
        value="₱2,667,561.36"
        subtitle="Net of VAT & Withholding"
        icon={<TrendingUp data-testid="stat-icon" size={20} />}
        color="emerald"
        onClick={handleClick}
      />,
    );

    expect(screen.getByText("Commissionable Revenue")).toBeInTheDocument();
    expect(screen.getByText("₱2,667,561.36")).toBeInTheDocument();
    expect(screen.getByText("Net of VAT & Withholding")).toBeInTheDocument();
    expect(screen.getByTestId("stat-icon")).toBeInTheDocument();

    const iconWrapper = container.querySelector(".shrink-0");
    expect(iconWrapper).toBeInTheDocument();

    fireEvent.click(screen.getByText("Commissionable Revenue"));
    expect(handleClick).toHaveBeenCalled();
  });
});
