import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import JourneyTab from "./JourneyTab";

const mockVisits = [
  {
    id: "visit-2",
    sequence: 2,
    enteredAt: "2026-09-28T11:37:00.000Z",
    leftAt: null,
    stage: { id: "stage-2", name: "For Bidding", bracket: null },
    conditions: [{ condition: { id: "c-open", label: "Open Condition" }, status: "unsatisfied" }],
    tasks: [],
    groupTasks: [],
    attachments: [],
    requestedItems: [],
  },
  {
    id: "visit-1",
    sequence: 1,
    enteredAt: "2026-09-28T11:36:00.000Z",
    leftAt: "2026-09-28T11:37:00.000Z",
    enteredBy: { id: "emp-1", name: "IT Admin", avatar_path: null },
    leftBy: { id: "emp-1", name: "IT Admin", avatar_path: null },
    stage: { id: "stage-1", name: "Qualified", bracket: null },
    conditions: [
      {
        condition: { id: "c-1", label: "BIDDING DOCS" },
        status: "satisfied",
        satisfiedBy: { id: "emp-1", name: "IT Admin", avatar_path: null },
        satisfiedAt: "2026-09-28T11:36:30.000Z",
        files: [
          {
            url: "https://res.cloudinary.test/bidding_requirements.pdf",
            name: "Bidding_Requirements.pdf",
            type: "pdf",
            bytes: 2500000,
            uploadedBy: "emp-1",
            uploadedAt: "2026-09-28T11:36:30.000Z",
            uploader: { id: "emp-1", name: "IT Admin", avatar_path: null },
          },
        ],
      },
    ],
    tasks: [],
    groupTasks: [
      {
        id: "gt-1",
        title: "TOR - No SO yet s s",
        status: "ON_HOLD",
        due_date: "2026-09-28T11:36:00.000Z",
        creator: { id: "emp-1", name: "IT Admin", avatar_path: null },
        members: [
          {
            id: "m-1",
            role: "Lead",
            task_description: "Draft TOR statement of work",
            status: "DONE",
            employee: { id: "emp-1", name: "IT Admin", avatar_path: null },
          },
          {
            id: "m-2",
            role: "Reviewer",
            task_description: "Review TOR",
            status: "PENDING",
            employee: { id: "emp-2", name: "Jane Doe", avatar_path: null },
          },
        ],
      },
    ],
    attachments: [
      {
        url: "https://res.cloudinary.test/bidding_requirements.pdf",
        name: "Bidding_Requirements.pdf",
        type: "pdf",
        bytes: 2500000,
        uploadedBy: "emp-1",
        uploadedAt: "2026-09-28T11:36:30.000Z",
        uploader: { id: "emp-1", name: "IT Admin", avatar_path: null },
      },
    ],
    requestedItems: [],
  },
];

vi.mock("./useSorModalData", () => ({
  useSorModalData: () => ({
    data: mockVisits,
    isLoading: false,
  }),
}));

describe("JourneyTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders past stages and expands to show Deliverables & Files", () => {
    window.open = vi.fn();
    render(<JourneyTab opportunityId="deal-1" hasOpened={() => true} onGoToNow={() => {}} />);

    expect(screen.getByText("For Bidding")).toBeInTheDocument();
    expect(screen.getByText("Earlier stages (1)")).toBeInTheDocument();

    const stageToggle = screen.getByRole("button", { name: /Qualified/i });
    expect(stageToggle).toBeInTheDocument();

    // Expand Qualified visit
    fireEvent.click(stageToggle);

    // Deliverables section
    expect(screen.getByText(/Deliverables & Files/i)).toBeInTheDocument();
    expect(screen.getAllByText("Bidding_Requirements.pdf").length).toBeGreaterThan(0);
    expect(screen.getByText("2.4 MB")).toBeInTheDocument();

    // Clicking Open calls window.open
    const fileOpenBtn = screen.getAllByRole("button", { name: /^Open$/i })[0];
    fireEvent.click(fileOpenBtn);
    expect(window.open).toHaveBeenCalledWith(
      "https://res.cloudinary.test/bidding_requirements.pdf",
      "_blank",
      "noopener,noreferrer"
    );
  });

  it("renders group tasks using TaskRow with progress, avatars, and dispatches OPEN_ENTITY_DETAILS", () => {
    const handler = vi.fn();
    window.addEventListener("OPEN_ENTITY_DETAILS", handler);

    render(<JourneyTab opportunityId="deal-1" hasOpened={() => true} onGoToNow={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Qualified/i }));

    // Task title and badges
    const taskTitleBtn = screen.getByTitle("TOR - No SO yet s s");
    expect(taskTitleBtn).toBeInTheDocument();
    expect(screen.getByText("Held")).toBeInTheDocument();
    expect(screen.getByText("1/2")).toBeInTheDocument();

    // Title click dispatches OPEN_ENTITY_DETAILS
    fireEvent.click(taskTitleBtn);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: { id: "gt-1", type: "GROUP_TASK" },
      })
    );

    window.removeEventListener("OPEN_ENTITY_DETAILS", handler);
  });

  it("expands the group task in-place to show members, roles, subtasks, and done status", () => {
    render(<JourneyTab opportunityId="deal-1" hasOpened={() => true} onGoToNow={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Qualified/i }));

    // Expand group task
    const expandTaskBtn = screen.getByLabelText("Expand TOR - No SO yet s s");
    fireEvent.click(expandTaskBtn);

    // Subtasks for members
    expect(screen.getByText("(Lead)")).toBeInTheDocument();
    expect(screen.getByText("Draft TOR statement of work")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();

    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    expect(screen.getByText("(Reviewer)")).toBeInTheDocument();
    expect(screen.getByText("Review TOR")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
  });

  it("renders the audit footnote at the bottom of the expanded stage", () => {
    render(<JourneyTab opportunityId="deal-1" hasOpened={() => true} onGoToNow={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Qualified/i }));

    expect(screen.getByText(/Entered by/i)).toBeInTheDocument();
    expect(screen.getByText(/left by/i)).toBeInTheDocument();
  });
});
