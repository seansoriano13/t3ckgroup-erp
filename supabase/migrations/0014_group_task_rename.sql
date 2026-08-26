-- ==============================================================================
-- 0014_group_task_rename.sql
--
-- Data-side half of the "Committee Task" -> "Group Task" rename.
--
-- SCOPE NOTE: the rename is deliberately frontend-only (T2). The committee_*
-- TABLES and COLUMNS keep their names — renaming them would drag every FK,
-- RLS policy and PostgREST embed alias along for no user-visible gain. What
-- this migration touches is only the *string values* the app reads back and
-- branches on, which would otherwise stop matching the renamed frontend.
--
-- Idempotent: safe to re-run.
-- Runs as one transaction: a failure anywhere leaves the database untouched
-- rather than stranding chat_read_receipts without its CHECK constraint.
-- ==============================================================================

begin;

-- Fail fast instead of bringing down the app if a lock cannot be acquired
set local lock_timeout = '2s';

-- ── 0. Refuse to run if entity_type holds anything unexpected ────────────────
-- The constraint below enumerates the allowed values. If production has some
-- value this migration does not know about, adding the constraint would fail
-- *after* the old one was dropped. Checking first turns that into a clean
-- abort with a readable message instead.
do $$
declare
  stray text;
begin
  select string_agg(distinct entity_type, ', ')
  into stray
  from public.chat_read_receipts
  where entity_type not in ('TASK', 'SALES', 'COMMITTEE_TASK', 'GROUP_TASK');

  if stray is not null then
    raise exception
      'chat_read_receipts.entity_type holds unexpected value(s): %. Add them to the CHECK in this migration before running it.',
      stray;
  end if;
end $$;

-- ── 1. entity_type: widen the CHECK before touching any rows ─────────────────
-- chat_read_receipts.entity_type is CHECK-constrained AND part of the primary
-- key (user_id, entity_type, entity_id). The constraint has to accept the new
-- value before the backfill runs, or the UPDATE below violates it.
--
-- The existing constraint was declared inline and is therefore auto-named. We
-- do not assume that name: dropping by a guessed name would silently no-op and
-- leave the original constraint in place alongside the new one, at which point
-- every GROUP_TASK insert would fail the old CHECK. Instead every CHECK
-- constraint on this table mentioning entity_type is discovered and dropped.
--
-- Both spellings are allowed for one release. The app writes GROUP_TASK only,
-- but a client still running the pre-rename bundle can insert COMMITTEE_TASK
-- after this migration lands; a CHECK violation there is a hard insert error,
-- not a degraded link. See LEGACY_TYPE_ALIASES in src/utils/notificationRouter.js.
do $$
declare
  c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'chat_read_receipts'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%entity_type%'
  loop
    execute format(
      'alter table public.chat_read_receipts drop constraint %I',
      c.conname
    );
  end loop;
end $$;

-- TODO: once no COMMITTEE_TASK rows remain and every client is past the
-- transition, tighten this to array['TASK', 'SALES', 'GROUP_TASK'].
alter table public.chat_read_receipts
  add constraint chat_read_receipts_entity_type_check
  check (entity_type = any (array[
    'TASK'::text,
    'SALES'::text,
    'COMMITTEE_TASK'::text,  -- TODO: drop after the transition release
    'GROUP_TASK'::text
  ])) not valid;

-- Validate the constraint without taking an ACCESS EXCLUSIVE lock
commit;
alter table public.chat_read_receipts validate constraint chat_read_receipts_entity_type_check;
begin;


-- ── 2. Backfill entity_type ──────────────────────────────────────────────────
-- entity_type is part of the primary key on both tables, so a straight UPDATE
-- would fail if a GROUP_TASK row already existed for the same (user, entity).
-- GROUP_TASK is new as of this migration so that cannot happen on a first run,
-- but the NOT EXISTS guard keeps a re-run safe; any row that would collide is
-- dropped instead, since the GROUP_TASK row is the newer read receipt.
delete from public.chat_read_receipts old
where old.entity_type = 'COMMITTEE_TASK'
  and exists (
    select 1 from public.chat_read_receipts cur
    where cur.user_id = old.user_id
      and cur.entity_id = old.entity_id
      and cur.entity_type = 'GROUP_TASK'
  );

update public.chat_read_receipts
set entity_type = 'GROUP_TASK'
where entity_type = 'COMMITTEE_TASK';

delete from public.chat_user_archives old
where old.entity_type = 'COMMITTEE_TASK'
  and exists (
    select 1 from public.chat_user_archives cur
    where cur.user_id = old.user_id
      and cur.entity_id = old.entity_id
      and cur.entity_type = 'GROUP_TASK'
  );

update public.chat_user_archives
set entity_type = 'GROUP_TASK'
where entity_type = 'COMMITTEE_TASK';

-- Note: chat_user_archives.entity_type has no CHECK constraint, so it only
-- needs the backfill. system_audit_logs also has an entity_type column, but no
-- group/committee service ever writes to it (they use committee_task_logs and
-- committee_task_activity instead), so it holds no COMMITTEE_TASK rows.

-- ── 3. Backfill notification types ───────────────────────────────────────────
-- notifications.type is unconstrained text, read by notificationRouter.js to
-- pick a deep link. Old rows must keep routing; the router accepts both
-- spellings during the transition, this backfill converts the existing ones.
update public.notifications
set type = 'GROUP_ASSIGNED'
where type = 'COMMITTEE_ASSIGNED';

update public.notifications
set type = 'GROUP_MEMBER_DONE'
where type = 'COMMITTEE_MEMBER_DONE';

update public.notifications
set type = 'GROUP_TASK_READY_FOR_HR'
where type = 'COMMITTEE_TASK_READY_FOR_HR';

update public.notifications
set type = 'GROUP_TASK_COMMENT'
where type = 'COMMITTEE_TASK_COMMENT';

-- Note: notifications.title / .message are free text written at send time and
-- are left as-is. Historical rows keep saying "Committee Task"; that is a
-- record of what was sent, not a routing key.

commit;
