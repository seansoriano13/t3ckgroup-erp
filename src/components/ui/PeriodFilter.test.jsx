import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { setupUser } from "@/test/support";
import PeriodFilter from "./PeriodFilter";
import { periodValue } from "@/lib/period";

describe("periodValue", () => {
  const day = new Date(2026, 8, 5);
  it("is the year, month or day the timeframe filters on", () => {
    expect(periodValue("YEARLY", day)).toBe("2026");
    expect(periodValue("MONTHLY", day)).toBe("2026-09");
    expect(periodValue("DAILY", day)).toBe("2026-09-05");
    expect(periodValue("WEEKLY", day)).toBe("2026-09-05");
  });
});

describe("PeriodFilter", () => {
  afterEach(() => vi.useRealTimers());

  it("moves the date to the current period when the timeframe changes", async () => {
    const user = setupUser();
    const onTimeframeChange = vi.fn();
    const onChange = vi.fn();
    render(
      <PeriodFilter timeframe="DAILY" onTimeframeChange={onTimeframeChange} value="" onChange={onChange} />,
    );

    await user.click(screen.getByRole("button", { name: "Timeframe: Daily" }));
    await user.click(screen.getByRole("button", { name: "Yearly" }));

    expect(onTimeframeChange).toHaveBeenCalledWith("YEARLY");
    expect(onChange).toHaveBeenCalledWith(String(new Date().getFullYear()));
  });

  it("clears the date from the x, only while a date is set", async () => {
    const user = setupUser();
    const onChange = vi.fn();
    const { rerender } = render(
      <PeriodFilter timeframe="YEARLY" onTimeframeChange={() => {}} value="" onChange={onChange} />,
    );
    expect(screen.queryByRole("button", { name: "Clear date" })).not.toBeInTheDocument();

    rerender(<PeriodFilter timeframe="YEARLY" onTimeframeChange={() => {}} value="2026" onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Clear date" }));
    expect(onChange).toHaveBeenCalledWith("");
  });
});
