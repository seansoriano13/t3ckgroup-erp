import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router";
import ApprovalsRedirect from "../../pages/approvals/index";
import * as AuthContext from "../../context/AuthContext";

describe("ApprovalsRedirect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function renderRedirect(user) {
    vi.spyOn(AuthContext, "useAuth").mockReturnValue({
      user,
      isAuthLoading: false,
    });

    return render(
      <MemoryRouter initialEntries={["/approvals"]}>
        <Routes>
          <Route path="/approvals" element={<ApprovalsRedirect />} />
          <Route path="/approvals/tasks" element={<div>Tasks Approval Page</div>} />
          <Route path="/approvals/hr-verification" element={<div>HR Verification Page</div>} />
          <Route path="/approvals/ipas" element={<div>IPAS Sign-offs Page</div>} />
          <Route path="/approvals/bid-decisions" element={<div>Bid Decisions Page</div>} />
          <Route path="/" element={<div>Dashboard Root</div>} />
        </Routes>
      </MemoryRouter>
    );
  }

  it("redirects Department Head to /approvals/tasks", () => {
    const user = { id: "h1", isHead: true };
    renderRedirect(user);
    expect(screen.getByText("Tasks Approval Page")).toBeInTheDocument();
  });

  it("redirects HR user to /approvals/hr-verification", () => {
    const user = { id: "hr1", isHr: true, isHead: false, isSuperAdmin: false };
    renderRedirect(user);
    expect(screen.getByText("HR Verification Page")).toBeInTheDocument();
  });

  it("sends someone whose only queue is IPAS to the IPAS sign-offs", () => {
    renderRedirect({ id: "a1", isIpasApprover: true });
    expect(screen.getByText("IPAS Sign-offs Page")).toBeInTheDocument();
  });

  it("keeps the other queues first for someone who has them and is also an IPAS approver", () => {
    renderRedirect({ id: "h2", isHead: true, isIpasApprover: true });
    expect(screen.getByText("Tasks Approval Page")).toBeInTheDocument();
  });

  it("sends HR first, then IPAS, when both apply", () => {
    renderRedirect({ id: "hr2", isHr: true, isIpasApprover: true });
    expect(screen.getByText("HR Verification Page")).toBeInTheDocument();
  });

  it("sends someone on the Final Acquire list, with no other queue, to the Bid Decisions", () => {
    renderRedirect({ id: "f1", isFinalAcquire: true });
    expect(screen.getByText("Bid Decisions Page")).toBeInTheDocument();
  });

  it("redirects unauthorized user to /", () => {
    const user = { id: "u1", isHr: false, isHead: false, isSuperAdmin: false };
    renderRedirect(user);
    expect(screen.getByText("Dashboard Root")).toBeInTheDocument();
  });
});
