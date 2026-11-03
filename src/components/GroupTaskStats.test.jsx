import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import GroupTaskStats from "./GroupTaskStats.jsx";

const task = (status, created_at) => ({ id: `${status}-${created_at}`, status, created_at });

describe("GroupTaskStats", () => {
  it("counts each status for tasks started inside the range", () => {
    render(
      <MemoryRouter>
        <GroupTaskStats
          selectedRange={{ startDate: "2026-11-01", endDate: "2026-12-01" }}
          groupTasks={[
            task("ACTIVE", "2026-11-05T00:00:00Z"),
            task("ACTIVE", "2026-11-06T00:00:00Z"),
            task("AWAITING_EVALUATION", "2026-11-07T00:00:00Z"),
            task("HR_VERIFIED", "2026-10-02T00:00:00Z"),
          ]}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("Active").closest("div")).toHaveTextContent("2");
    expect(screen.getByText("All group tasks").closest("div")).toHaveTextContent("3");
    expect(screen.getByText("HR verified").closest("div")).toHaveTextContent("0");
  });
});
