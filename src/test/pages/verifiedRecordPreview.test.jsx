import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import VerifiedRecordPreview from "@/components/verify/VerifiedRecordPreview";

const rpc = vi.fn();
let mockUser = null;

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (...a) => rpc(...a),
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
    }),
  },
}));
vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser, isAuthLoading: false }),
}));

const record = (over = {}) => ({
  form_type: "Leave",
  employee_name: "Dani Test",
  category: "Vacation",
  inclusive_dates: "Mar 10, 2026",
  total_hours: 8,
  status: "PENDING",
  application_valid: true,
  approval_valid: null,
  ...over,
});

function renderPage() {
  return render(
    <MemoryRouter>
      <VerifiedRecordPreview token="abc" standalone />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  rpc.mockReset();
  mockUser = null;
});

describe("Verify page headline", () => {
  it("is green when every check passed", async () => {
    rpc.mockResolvedValue({ data: record(), error: null });
    renderPage();
    expect(await screen.findByText("Verified Record")).toBeTruthy();
    expect(screen.queryByText("Does not match")).toBeNull();
  });

  it("is a red 'Does not match' with the reason when the employee signature check failed", async () => {
    rpc.mockResolvedValue({ data: record({ application_valid: false }), error: null });
    renderPage();
    expect(await screen.findByText("Does not match")).toBeTruthy();
    expect(screen.queryByText("Verified Record")).toBeNull();
    expect(screen.getByText(/Signature check failed for the employee signature/)).toBeTruthy();
    expect(screen.getByText("PENDING")).toBeTruthy();
  });

  it("keeps the HR Approved exception for an approved record", async () => {
    rpc.mockResolvedValue({ data: record({ status: "APPROVED", application_valid: false }), error: null });
    renderPage();
    expect(await screen.findByText("Verified Record")).toBeTruthy();
    expect(screen.getByText("Record Validated (HR Approved)")).toBeTruthy();
  });

  it("says '1 hr' for one hour and 'hrs' otherwise", async () => {
    rpc.mockResolvedValue({ data: record({ total_hours: 1 }), error: null });
    const { unmount } = renderPage();
    expect(await screen.findByText("1 hr")).toBeTruthy();
    unmount();
    rpc.mockResolvedValue({ data: record({ total_hours: 8 }), error: null });
    renderPage();
    expect(await screen.findByText("8 hrs")).toBeTruthy();
  });
});

describe("Verify page limit", () => {
  it("says too many checks, never Record Not Found, when the limit code comes back", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "VF429", message: "verify_rate_limited" } });
    renderPage();
    expect(await screen.findByText(/Too many checks from this network\. Wait a minute and try again\./)).toBeTruthy();
    expect(screen.queryByText("Record Not Found")).toBeNull();
  });

  it("still says Record Not Found for a made-up code", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    renderPage();
    expect(await screen.findByText("Record Not Found")).toBeTruthy();
  });
});
