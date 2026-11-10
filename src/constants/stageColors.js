/**
 * The one map of Stage colors (#930). A Stage's `color` (flow_stages.color) is one
 * of these names, picked on the flow canvas; `flowStageTone` falls back to blue,
 * green, amber or mauve by the Stage's role. Wherever a Stage is drawn as a solid
 * fill (the SOR window's stage strip, its charts, the canvas color picker) the
 * class comes from here.
 *
 * Every class is spelled out in full: Tailwind ships only the classes it finds
 * written whole, so a class built from the name would render nothing, and a name
 * missing here once fell back to black (the SOR window, 2026-11-09).
 */
export const STAGE_COLOR_FILL = {
  tomato: "bg-tomato-9",
  red: "bg-red-9",
  crimson: "bg-crimson-9",
  pink: "bg-pink-9",
  plum: "bg-plum-9",
  violet: "bg-violet-9",
  indigo: "bg-indigo-9",
  blue: "bg-blue-9",
  sky: "bg-sky-9",
  cyan: "bg-cyan-9",
  teal: "bg-teal-9",
  jade: "bg-jade-9",
  green: "bg-green-9",
  lime: "bg-lime-9",
  yellow: "bg-yellow-9",
  amber: "bg-amber-9",
  orange: "bg-orange-9",
  gold: "bg-gold-9",
  brown: "bg-brown-9",
  gray: "bg-gray-9",
  // A step darker than the strip's visited Stages (mauve-8), so a mauve current Stage still stands out.
  mauve: "bg-mauve-10",
};

/** The solid fill for a Stage color name; a name not in the map reads as the neutral mauve, never black. */
export const stageColorFill = (tone) => STAGE_COLOR_FILL[tone] ?? STAGE_COLOR_FILL.mauve;
