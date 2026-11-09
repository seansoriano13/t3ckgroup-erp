-- #935 (spec #927): one-click signing on a Transmittal stage, with a quick Undo.
--
-- After a stage is signed the signer has a 15 second window (the toast shows
-- for 10; the rest is slack for the network) to undo it with no reason.
--   - The notices the signature owes (next signer, co-signer to confirm, NA
--     alert) are HELD for that window in transmittal_pending_notices, then
--     written by transmittal_flush_notices(). A quick undo cancels them, so
--     nobody hears of a signature that was undone inside the window.
--   - The flush runs every minute from pg_cron, so the notices go out even if
--     the signer closes the page. The page also asks for a flush when the
--     window ends, so they arrive within seconds.
--   - transmittal_quick_undo is the signer's own undo, inside the window only.
--     It reuses transmittal_undo_signature (so every ordering rule still holds)
--     with the reason "Undone right after signing", which History shows.
--     Undo after the window is the existing transmittal_undo_signature, unchanged.
--
-- SAFE TO RUN AT ANY TIME: a new table and three new functions. Idempotent.

create extension if not exists pg_cron with schema extensions;

create table if not exists public.transmittal_pending_notices (
  id             uuid primary key default gen_random_uuid(),
  transmittal_id uuid not null references public.transmittals (id) on delete cascade,
  stage_id       uuid not null references public.transmittal_stages (id) on delete cascade,
  notices        jsonb not null,
  due_at         timestamptz not null,
  sent_at        timestamptz,
  cancelled_at   timestamptz,
  created_at     timestamptz not null default now()
);

create index if not exists transmittal_pending_notices_due_idx
  on public.transmittal_pending_notices (due_at)
  where sent_at is null and cancelled_at is null;

alter table public.transmittal_pending_notices enable row level security;
-- No policies: only the security definer functions below touch it.

comment on table public.transmittal_pending_notices is
  '#935: notices a Transmittal signature owes, held until the quick-undo window passes. Written and sent only by transmittal_hold_notices / transmittal_flush_notices.';

-- ------------------------------------------------------------------------------
-- Hold the notices of a signature just made (called by the signer)
-- ------------------------------------------------------------------------------

-- p_notices: [{ recipient_id, type, title, message, reference_id }]
create or replace function public.transmittal_hold_notices(p_transmittal_id uuid, p_stage text, p_notices jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_stage public.transmittal_stages;
begin
  if v_actor is null then
    raise exception 'transmittal_hold_notices: not signed in' using errcode = '42501';
  end if;
  select * into v_stage from public.transmittal_stages s
   where s.transmittal_id = p_transmittal_id and s.stage = p_stage for update;
  if not found or v_stage.completed_at is null or v_stage.completed_by is distinct from v_actor then
    raise exception 'transmittal_hold_notices: only the signer of a signed stage holds its notices' using errcode = '42501';
  end if;
  if v_stage.completed_at < now() - interval '15 seconds' then
    raise exception 'transmittal_hold_notices: the quick-undo window has passed' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_notices, '[]'::jsonb)) <> 'array' then
    raise exception 'transmittal_hold_notices: notices must be a list' using errcode = '22023';
  end if;

  insert into public.transmittal_pending_notices (transmittal_id, stage_id, notices, due_at)
  values (v_stage.transmittal_id, v_stage.id, coalesce(p_notices, '[]'::jsonb), v_stage.completed_at + interval '15 seconds');

  return jsonb_build_object('due_at', v_stage.completed_at + interval '15 seconds');
end;
$$;

-- ------------------------------------------------------------------------------
-- Send the held notices whose window has passed
-- ------------------------------------------------------------------------------

create or replace function public.transmittal_flush_notices()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
  v_row record;
begin
  for v_row in
    select * from public.transmittal_pending_notices p
     where p.sent_at is null and p.cancelled_at is null and p.due_at <= now()
     order by p.due_at
     for update skip locked
  loop
    insert into public.notifications (recipient_id, type, title, message, reference_id)
    select (n ->> 'recipient_id')::uuid, n ->> 'type', n ->> 'title', n ->> 'message', n ->> 'reference_id'
      from jsonb_array_elements(v_row.notices) n
     where n ->> 'recipient_id' is not null;
    update public.transmittal_pending_notices set sent_at = now() where id = v_row.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ------------------------------------------------------------------------------
-- The signer's quick undo
-- ------------------------------------------------------------------------------

create or replace function public.transmittal_quick_undo(p_transmittal_id uuid, p_stage text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_stage public.transmittal_stages;
  v_result jsonb;
begin
  if v_actor is null then
    raise exception 'transmittal_quick_undo: not signed in' using errcode = '42501';
  end if;

  select * into v_stage from public.transmittal_stages s
   where s.transmittal_id = p_transmittal_id and s.stage = p_stage
   for update;
  if not found or v_stage.completed_at is null then
    raise exception 'transmittal_quick_undo: that stage is not signed' using errcode = '22023';
  end if;
  if v_stage.completed_by is distinct from v_actor then
    raise exception 'transmittal_quick_undo: only the person who signed can undo this way' using errcode = '42501';
  end if;
  if v_stage.completed_at < now() - interval '15 seconds' then
    raise exception 'transmittal_quick_undo: the quick-undo window has passed; undo with a reason' using errcode = '42501';
  end if;

  -- Nobody hears of it: cancel the notices still held for this signature.
  update public.transmittal_pending_notices
     set cancelled_at = now()
   where stage_id = v_stage.id and sent_at is null and cancelled_at is null;

  v_result := public.transmittal_undo_signature(p_transmittal_id, 'stage', 'Undone right after signing', p_stage, null);
  return v_result - 'notify_ids';
end;
$$;

revoke all on function public.transmittal_hold_notices(uuid, text, jsonb) from public, anon;
revoke all on function public.transmittal_flush_notices() from public, anon;
revoke all on function public.transmittal_quick_undo(uuid, text) from public, anon;
grant execute on function public.transmittal_hold_notices(uuid, text, jsonb) to authenticated;
grant execute on function public.transmittal_flush_notices() to authenticated;
grant execute on function public.transmittal_quick_undo(uuid, text) to authenticated;

select cron.unschedule(jobname)
from cron.job
where jobname = 'transmittal-flush-notices';

select cron.schedule(
  'transmittal-flush-notices',
  '* * * * *',
  $$select public.transmittal_flush_notices();$$
);
