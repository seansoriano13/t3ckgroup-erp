// The 7 names task_tags.color is constrained to — the same palette Stages
// use (flow_stages_color_check), so a tag pill and a Stage badge read as one
// visual language.
export const TASK_TAG_COLOR_CLASSES = {
  mauve: "bg-mauve-4 text-mauve-11 border-mauve-6",
  amber: "bg-amber-4 text-amber-11 border-amber-6",
  blue: "bg-blue-4 text-blue-11 border-blue-6",
  red: "bg-red-4 text-red-11 border-red-6",
  violet: "bg-violet-4 text-violet-11 border-violet-6",
  orange: "bg-orange-4 text-orange-11 border-orange-6",
  green: "bg-green-4 text-green-11 border-green-6",
};

export function taskTagClasses(color) {
  return TASK_TAG_COLOR_CLASSES[color] || TASK_TAG_COLOR_CLASSES.mauve;
}
