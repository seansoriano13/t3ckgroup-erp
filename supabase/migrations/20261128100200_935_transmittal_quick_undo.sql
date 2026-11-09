-- #935 (spec #927): one-click signing on a Transmittal stage, with a quick Undo.
--
-- After a stage is signed the signer has a 15 second window (the toast shows
-- for 10; the rest is slack for the network) to undo it with no reason.
--   - The notices the signature owes (next signer, co-signer to confirm, NA
--     alert) are HELD for that window in transmittal_pending_notices, then
--     written by transmittal_flush_notices(). A quick undo cancels them, so
--     nobody hears of a signature that was undone inside the window.
--   - The database BUILDS the notices itself, from the signed stage and the
--     staff lists (the same recipients transmittal_complete_stage returned).
--     The caller sends nothing, so a signer cannot make the server write a
--     notice to anyone, of any type, with any text.
--   - The flush runs every minute from pg_cron, so the notices go out even if
--     the signer closes the page. The page also asks for a flush when the
--     window ends, so they arrive within seconds; a signed-in caller can only
--     flush their own signatures' notices, the cron job flushes everything.
--   - transmittal_quick_undo is the signer's own undo, inside the window only.
--     It reuses transmittal_undo_signature (so every ordering rule still holds)
--     with the reason "Undone right after signing", which History shows.
--     Undo after the window is the existing transmittal_undo_signature, unchanged.
--   - The window has one edge: a notice is flushed only STRICTLY after
--     signed_at + window, an undo is allowed only up to and including it
--     (both read clock_timestamp()), and an undo that finds its notices already
--     sent is refused rather than lost.
--
-- SAFE TO RUN AT ANY TIME: a new table and new functions. Idempotent.

create extension if not exists pg_cron with schema extensions;

-- The one place the window length lives on the database side (the page keeps
-- its own copy of the number: QUICK_UNDO_WINDOW_MS in src/constants/transmittals.js).
create or replace function public.transmittal_quick_undo_window()
returns interval
language sql
immutable
as $$ select interval '15 seconds' $$;

create table if not exists public.transmittal_pending_notices (
  id             uuid primary key default gen_random_uuid(),
  transmittal_id uuid not null references public.transmittals (id) on delete cascade,
  stage_id       uuid not null references public.transmittal_stages (id) on delete cascade,
  signer_id      uuid references public.employees (id) on delete set null,
  signed_at      timestamptz,
  notices        jsonb not null,
  due_at         timestamptz not null,
  sent_at        timestamptz,
  cancelled_at   timestamptz,
  created_at     timestamptz not null default now()
);

-- Re-run safe for a database that already has the first version of the table.
alter table public.transmittal_pending_notices add column if not exists signer_id uuid references public.employees (id) on delete set null;
alter table public.transmittal_pending_notices add column if not exists signed_at timestamptz;

create index if not exists transmittal_pending_notices_due_idx
  on public.transmittal_pending_notices (due_at)
  where sent_at is null and cancelled_at is null;

-- One hold per signature (a stage that is undone and signed again has a new signed_at).
create unique index if not exists transmittal_pending_notices_signature_key
  on public.transmittal_pending_notices (stage_id, signed_at);

alter table public.transmittal_pending_notices enable row level security;
-- No policies: only the security definer functions below touch it.

comment on table public.transmittal_pending_notices is
  '#935: notices a Transmittal signature owes, held until the quick-undo window passes. Written and sent only by transmittal_hold_notices / transmittal_flush_notices.';

-- ------------------------------------------------------------------------------
-- Hold the notices of a signature just made (called by the signer)
-- ------------------------------------------------------------------------------

drop function if exists public.transmittal_hold_notices(uuid, text, jsonb);

create or replace function public.transmittal_hold_notices(p_transmittal_id uuid, p_stage text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.get_employee_id();
  v_stage public.transmittal_stages;
  v_row public.transmittals;
  v_number text;
  v_next_list text;
  v_next_label text;
  v_other uuid;
  v_na int := 0;
  v_notices jsonb := '[]'::jsonb;
  v_due timestamptz;
begin
  if v_actor is null then
    raise exception 'transmittal_hold_notices: not signed in' using errcode = '42501';
  end if;
  select * into v_stage from public.transmittal_stages s
   where s.transmittal_id = p_transmittal_id and s.stage = p_stage for update;
  if not found or v_stage.completed_at is null or v_stage.completed_by is distinct from v_actor then
    raise exception 'transmittal_hold_notices: only the signer of a signed stage holds its notices' using errcode = '42501';
  end if;
  v_due := v_stage.completed_at + public.transmittal_quick_undo_window();
  if clock_timestamp() > v_due then
    raise exception 'transmittal_hold_notices: the quick-undo window has passed' using errcode = '42501';
  end if;

  select * into v_row from public.transmittals t where t.id = p_transmittal_id;
  v_number := v_row.number;

  -- Who is next, as transmittal_complete_stage decided it.
  if p_stage = 'warehouse_checking' then
    if v_row.check_technical then
      v_next_list := 'transmittal_warehouse'; v_next_label := 'waiting on release';
    else
      v_next_list := 'transmittal_check_by'; v_next_label := 'awaiting Check by';
    end if;
  elsif p_stage = 'warehouse_releasing' then
    if v_row.check_technical then
      v_next_list := 'transmittal_technical'; v_next_label := 'waiting on Technical';
    end if;
  elsif p_stage = 'technical_inspection' then
    v_next_list := 'transmittal_check_by'; v_next_label := 'awaiting Check by';
  end if;

  if v_next_list is not null then
    v_notices := v_notices || coalesce((
      select jsonb_agg(jsonb_build_object(
        'recipient_id', l.employee_id,
        'type', 'TRANSMITTAL_STAGE_READY',
        'title', v_number || ' is waiting on you',
        'message', v_number || ' is ' || v_next_label || '.',
        'reference_id', p_transmittal_id::text))
        from public.ipas_signer_lists l
        join public.employees e on e.id = l.employee_id
       where l.list_key = v_next_list and not coalesce(e.is_deleted, false)
    ), '[]'::jsonb);
  end if;

  -- The registered co-signer who still has to confirm.
  v_other := case
    when v_stage.first_confirmed is false then v_stage.first_signer_id
    when v_stage.second_confirmed is false then v_stage.second_signer_id
  end;
  if v_other is not null and v_other <> v_actor then
    v_notices := v_notices || jsonb_build_array(jsonb_build_object(
      'recipient_id', v_other,
      'type', 'TRANSMITTAL_CONFIRM_SIGNATURE',
      'title', 'Confirm your signature on ' || v_number,
      'message', 'You are the second signatory on ' || v_number || '. Confirm or decline it.',
      'reference_id', p_transmittal_id::text));
  end if;

  -- NA lines: the preparer and the Check by list hear of them.
  if p_stage = 'warehouse_checking' then
    select count(*) into v_na from public.transmittal_lines l
     where l.transmittal_id = p_transmittal_id and l.wh_rating = 'na';
  elsif p_stage = 'technical_inspection' then
    select count(*) into v_na from public.transmittal_lines l
     where l.transmittal_id = p_transmittal_id and l.tech_rating = 'na';
  end if;
  if v_na > 0 then
    v_notices := v_notices || coalesce((
      select jsonb_agg(jsonb_build_object(
        'recipient_id', r.u,
        'type', 'TRANSMITTAL_NA_RAISED',
        'title', v_number || ' has NA lines',
        'message', v_number || ' was checked with ' || v_na || ' line' || case when v_na = 1 then '' else 's' end || ' rated NA.',
        'reference_id', p_transmittal_id::text))
        from (
          select v_row.prepared_by as u
          union
          select l.employee_id from public.ipas_signer_lists l
            join public.employees e on e.id = l.employee_id
           where l.list_key = 'transmittal_check_by' and not coalesce(e.is_deleted, false)
        ) r
       where r.u is not null
    ), '[]'::jsonb);
  end if;

  insert into public.transmittal_pending_notices (transmittal_id, stage_id, signer_id, signed_at, notices, due_at)
  values (v_stage.transmittal_id, v_stage.id, v_actor, v_stage.completed_at, v_notices, v_due)
  on conflict (stage_id, signed_at) do nothing;

  return jsonb_build_object('due_at', v_due);
end;
$$;

-- ------------------------------------------------------------------------------
-- Send the held notices whose window has passed
-- ------------------------------------------------------------------------------

-- The pg_cron job (no signed-in user) flushes everything due. A signed-in
-- caller flushes only the notices of signatures they made themselves.
create or replace function public.transmittal_flush_notices()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
  v_row record;
  v_all boolean := auth.uid() is null or coalesce(auth.role(), '') = 'service_role';
  v_actor uuid := public.get_employee_id();
begin
  if not v_all and v_actor is null then
    raise exception 'transmittal_flush_notices: not signed in' using errcode = '42501';
  end if;

  for v_row in
    select * from public.transmittal_pending_notices p
     where p.sent_at is null and p.cancelled_at is null
       and p.due_at < clock_timestamp()
       and (v_all or p.signer_id = v_actor)
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
  if clock_timestamp() > v_stage.completed_at + public.transmittal_quick_undo_window() then
    raise exception 'transmittal_quick_undo: the quick-undo window has passed; undo with a reason' using errcode = '42501';
  end if;

  -- Nobody hears of it: cancel the notices still held for this signature.
  -- If a flush already sent them (it holds the row lock, so this waited for it),
  -- the window is over: refuse instead of undoing a signature people were told of.
  update public.transmittal_pending_notices
     set cancelled_at = now()
   where stage_id = v_stage.id and signed_at = v_stage.completed_at
     and sent_at is null and cancelled_at is null;
  if exists (
    select 1 from public.transmittal_pending_notices
     where stage_id = v_stage.id and signed_at = v_stage.completed_at and sent_at is not null
  ) then
    raise exception 'transmittal_quick_undo: the quick-undo window has passed; undo with a reason' using errcode = '42501';
  end if;

  v_result := public.transmittal_undo_signature(p_transmittal_id, 'stage', 'Undone right after signing', p_stage, null);
  return v_result - 'notify_ids';
end;
$$;

revoke all on function public.transmittal_hold_notices(uuid, text) from public, anon;
revoke all on function public.transmittal_flush_notices() from public, anon;
revoke all on function public.transmittal_quick_undo(uuid, text) from public, anon;
grant execute on function public.transmittal_hold_notices(uuid, text) to authenticated;
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
