import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import RecordNotFound from "./RecordNotFound";
import { isRecordId } from "../../utils/recordLink";

describe("RecordNotFound", () => {
  it("names the record type and offers the way back", () => {
    const onBack = vi.fn();
    render(<RecordNotFound recordType="IPAS" onBack={onBack} backLabel="Back to IPAS" />);
    expect(screen.getByText("Not found, or not yours to see")).toBeInTheDocument();
    expect(screen.getByText(/This IPAS may have been deleted/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to IPAS" }));
    expect(onBack).toHaveBeenCalled();
  });
});

describe("isRecordId", () => {
  it("accepts a uuid and rejects anything else", () => {
    expect(isRecordId("11111111-1111-4111-8111-111111111111")).toBe(true);
    expect(isRecordId("not-a-real-id")).toBe(false);
    expect(isRecordId(null)).toBe(false);
  });
});
