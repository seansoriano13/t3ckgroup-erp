import { describe, expect, it } from "vitest";
import { STAGE_COLOR_FILL, stageColorFill } from "./stageColors";
import { dealStageAndTone } from "./salesFlow";
import { getStatusTheme } from "./status";
import { PIPELINE_STAGE_SEED } from "./sor";

// #930: the SOR window drew some Stages black and two statuses gray.

// Every color the flow canvas offers a Stage (StageSettingsPanel's swatches).
const CANVAS_COLORS = [
  "tomato", "red", "crimson", "pink", "plum", "violet", "indigo", "blue", "sky", "cyan",
  "teal", "jade", "green", "lime", "yellow", "amber", "orange", "gold", "brown", "mauve",
];

describe("Stage colors", () => {
  it("has a fill for every color the canvas offers", () => {
    for (const color of CANVAS_COLORS) expect(STAGE_COLOR_FILL[color], color).toMatch(new RegExp(`^bg-${color}-\\d+$`));
  });

  it("draws a color it doesn't know as neutral mauve, never black", () => {
    expect(stageColorFill("ultraviolet")).toBe(STAGE_COLOR_FILL.mauve);
    expect(stageColorFill(null)).toBe(STAGE_COLOR_FILL.mauve);
  });

  it("gives every pipeline status the color it is seeded with, For Bidding and Payment Verification included", () => {
    for (const stage of PIPELINE_STAGE_SEED) expect(getStatusTheme(stage.code), stage.code).toBe(stage.theme);
    expect(getStatusTheme("FOR_BIDDING")).toBe("amber");
    expect(getStatusTheme("PAYMENT_VERIFICATION")).toBe("amber");
  });
});

describe("dealStageAndTone", () => {
  const snapshot = {
    wonStageId: "won",
    stages: [
      { id: "lead", name: "Lead", sort_order: 1, color: null },
      { id: "teal", name: "Delivery", sort_order: 2, color: "teal" },
      { id: "won", name: "Closed Won", sort_order: 3, color: null },
    ],
  };
  // The live flow has since been edited: Delivery recolored, Closed Won renamed.
  const live = {
    flow: { won_stage_id: "won" },
    stages: [
      { id: "lead", name: "Lead", sort_order: 1, color: null },
      { id: "teal", name: "Delivery", sort_order: 2, color: "orange" },
      { id: "won", name: "Won", sort_order: 3, color: null },
      { id: "new", name: "Retention", sort_order: 4, color: "brown" },
    ],
  };

  it("reads the Stage and its color from the deal's snapshot, not the live flow", () => {
    expect(dealStageAndTone("teal", snapshot, live)).toMatchObject({ stage: { name: "Delivery" }, tone: "teal" });
    expect(dealStageAndTone("won", snapshot, live)).toMatchObject({ stage: { name: "Closed Won" }, tone: "green" });
    expect(dealStageAndTone("lead", snapshot, live).tone).toBe("blue");
  });

  it("falls back to the live flow while the snapshot loads or when it lacks the Stage", () => {
    expect(dealStageAndTone("teal", undefined, live)).toMatchObject({ stage: { name: "Delivery" }, tone: "orange" });
    expect(dealStageAndTone("new", snapshot, live)).toMatchObject({ stage: { name: "Retention" }, tone: "brown" });
  });

  it("has no Stage and reads mauve with neither", () => {
    expect(dealStageAndTone("teal", undefined, undefined)).toEqual({ stage: null, tone: "mauve" });
  });
});
