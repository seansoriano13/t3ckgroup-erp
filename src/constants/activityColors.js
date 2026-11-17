/**
 * The colours an Activity type can wear (#1064). A fixed set of the app's soft scales, so every one reads
 * well in light and dark mode. The class names are written out in full so Tailwind can see them.
 * Keep the keys in step with the `color` check on activity_type_settings.
 *   chip     a month-cell chip / list row
 *   dot      a small marker (also the solid fill)
 *   bar      a soft bar for a span
 *   text     the text colour alone
 *   soft     the soft fill for a small time button
 *   pending  the dashed-border colour for a pending one
 */
export const ACTIVITY_COLORS = {
  teal: { label: 'Teal', chip: 'bg-teal-2 text-teal-11 border-teal-6', dot: 'bg-teal-9', bar: 'bg-teal-5', text: 'text-teal-11', soft: 'bg-teal-3 hover:bg-teal-4', pending: 'border-teal-7' },
  indigo: { label: 'Indigo', chip: 'bg-indigo-2 text-indigo-11 border-indigo-6', dot: 'bg-indigo-9', bar: 'bg-indigo-5', text: 'text-indigo-11', soft: 'bg-indigo-3 hover:bg-indigo-4', pending: 'border-indigo-7' },
  orange: { label: 'Orange', chip: 'bg-orange-2 text-orange-11 border-orange-6', dot: 'bg-orange-9', bar: 'bg-orange-5', text: 'text-orange-11', soft: 'bg-orange-3 hover:bg-orange-4', pending: 'border-orange-7' },
  plum: { label: 'Plum', chip: 'bg-plum-2 text-plum-11 border-plum-6', dot: 'bg-plum-9', bar: 'bg-plum-5', text: 'text-plum-11', soft: 'bg-plum-3 hover:bg-plum-4', pending: 'border-plum-7' },
  blue: { label: 'Blue', chip: 'bg-blue-2 text-blue-11 border-blue-6', dot: 'bg-blue-9', bar: 'bg-blue-5', text: 'text-blue-11', soft: 'bg-blue-3 hover:bg-blue-4', pending: 'border-blue-7' },
  green: { label: 'Green', chip: 'bg-green-2 text-green-11 border-green-6', dot: 'bg-green-9', bar: 'bg-green-5', text: 'text-green-11', soft: 'bg-green-3 hover:bg-green-4', pending: 'border-green-7' },
  pink: { label: 'Pink', chip: 'bg-pink-2 text-pink-11 border-pink-6', dot: 'bg-pink-9', bar: 'bg-pink-5', text: 'text-pink-11', soft: 'bg-pink-3 hover:bg-pink-4', pending: 'border-pink-7' },
  amber: { label: 'Amber', chip: 'bg-amber-2 text-amber-11 border-amber-6', dot: 'bg-amber-9', bar: 'bg-amber-5', text: 'text-amber-11', soft: 'bg-amber-3 hover:bg-amber-4', pending: 'border-amber-7' },
  violet: { label: 'Violet', chip: 'bg-violet-2 text-violet-11 border-violet-6', dot: 'bg-violet-9', bar: 'bg-violet-5', text: 'text-violet-11', soft: 'bg-violet-3 hover:bg-violet-4', pending: 'border-violet-7' },
};

export const ACTIVITY_COLOR_KEYS = Object.keys(ACTIVITY_COLORS);
