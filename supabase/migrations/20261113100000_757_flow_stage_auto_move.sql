-- #757: a Stage with exactly one next Stage can move a deal on by itself.
alter table public.flow_stages
  add column if not exists auto_move boolean not null default false;
