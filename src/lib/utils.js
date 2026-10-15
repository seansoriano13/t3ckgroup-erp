import { clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge"

// `text-label` is a font size (--text-label in index.css). Unregistered,
// tailwind-merge reads it as a text colour and drops it beside one, so every
// caption fell back to 16px.
const twMerge = extendTailwindMerge({ extend: { theme: { text: ["label"] } } })

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
