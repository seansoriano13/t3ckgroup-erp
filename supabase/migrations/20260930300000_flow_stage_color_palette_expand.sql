-- Stage color palette grows from 7 to 20 Radix scales so a 15-20 stage flow
-- can give every stage its own color. Values are Radix scale names; the UI
-- maps them to Tailwind classes (FlowCanvasNode COLOR_* maps).
alter table public.flow_stages
  drop constraint if exists flow_stages_color_check;
alter table public.flow_stages
  add constraint flow_stages_color_check
  check (color is null or color in ('tomato', 'red', 'crimson', 'pink', 'plum', 'violet', 'indigo', 'blue', 'sky', 'cyan', 'teal', 'jade', 'green', 'lime', 'yellow', 'amber', 'orange', 'gold', 'brown', 'mauve'));
