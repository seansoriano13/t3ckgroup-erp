-- #167: A subscription table for desktop push notifications.
--
-- Keyed by employee and endpoint, so one person may hold several — the same
-- employee subscribed from two different computers is two rows, not a
-- conflict. The unique constraint on (employee_id, endpoint) is what makes
-- subscribing twice from the same browser an upsert rather than a duplicate.

create table if not exists public.push_subscriptions (
  "id" uuid not null default gen_random_uuid(),
  "employee_id" uuid not null references public.employees(id),
  "endpoint" text not null,
  "p256dh" text not null,
  "auth" text not null,
  "created_at" timestamp with time zone not null default timezone('utc'::text, now()),
  constraint push_subscriptions_pkey primary key (id),
  constraint push_subscriptions_employee_endpoint_key unique (employee_id, endpoint)
);

create index if not exists push_subscriptions_employee_id_idx
  on public.push_subscriptions (employee_id);

alter table public.push_subscriptions enable row level security;

-- An employee manages only their own subscriptions from the browser. The
-- edge function that sends pushes reads across employees with the service
-- role, which bypasses RLS entirely, so no policy here needs to permit that.
create policy "Users can view own push subscriptions"
  on public.push_subscriptions
  for select
  to authenticated
  using (employee_id = get_employee_id());

create policy "Users can create own push subscriptions"
  on public.push_subscriptions
  for insert
  to authenticated
  with check (employee_id = get_employee_id());

create policy "Users can delete own push subscriptions"
  on public.push_subscriptions
  for delete
  to authenticated
  using (employee_id = get_employee_id());
