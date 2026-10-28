-- Meal Break (#759): HR-set meal windows and the keep-in reason on review.
create table if not exists meal_break_settings (
  key text primary key,
  start_time time not null,
  end_time time not null,
  enabled boolean not null default false
);
insert into meal_break_settings (key, start_time, end_time, enabled) values
  ('lunch', '12:00', '13:00', true),
  ('breakfast', '06:00', '07:00', false),
  ('dinner', '18:00', '19:00', false)
on conflict (key) do nothing;

alter table overtime_requests add column if not exists meal_break_kept_reason text;
alter table offset_requests add column if not exists meal_break_kept_reason text;
alter table sil_leaves add column if not exists meal_break_kept_reason text;
alter table lwop_leaves add column if not exists meal_break_kept_reason text;
alter table undertime_requests add column if not exists meal_break_kept_reason text;
