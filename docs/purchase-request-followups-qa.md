# QA: Purchase Request follow-ups (#209)

Local stack only. Mock accounts (password = `CAST_PASSWORD` in `src/test/policy/support/cast.js`):
Bea Buyer (`bea.buyer@demo.local`, Purchasing), Paolo Purchaser (`paolo.purchaser@demo.local`, Purchasing),
Sal Sales (`sal.sales@demo.local`, Deal Owner), Nina Newhire (`nina.newhire@demo.local`, no Purchasing yet),
Local Solo Dev (`dev@local.com`, Super Admin). SORs are titled `[Demo] <letter> …`.

## SOR closes / reopens → Buyer told
- [x] 1. A: delete SOR (UI) → Bea gets "SOR was deleted", one notification
- [x] 2. B: delete SOR with every item closed → Bea gets nothing
- [x] 3. C: move SOR to Lost → Bea gets "SOR was lost"
- [x] 4. D: move SOR to Won → Bea gets nothing
- [x] 5. E: Lost, then delete → Bea gets exactly one notification
- [x] 6. F: delete, then restore from the Deleted view → Bea gets "was deleted" then "was restored"
- [x] 7. G (no Buyer): delete → Paolo (purchasing member) told; Sal (sales) not told
- [x] 8. Clicking the notification opens the Purchase Request

## Purchasing access follows the flag
- [x] 9. Grant Nina Purchasing access (UI, as Super Admin) → Nina in H (open items) and I (empty)
- [x] 10. Nina NOT in J (finished) or L (deleted SOR)
- [x] 11. K: Nina (was "other") now purchasing side → can change item status; SOR window open
- [x] 12. Remove Nina from M by hand, then edit an unrelated field on Nina → not re-added to M
- [x] 13. Revoke Nina's access → still a member of H/K, but no longer purchasing (can't set status); K window closed

## Refactor regressions
- [x] 14. Procurement Queue open counts correct (closed-item helper)
- [x] 15. A closed item can't change status; open item transitions still work

## Result (2026-10-08, browser, local stack): 15/15 pass

Notes found along the way (not caused by this change):
- Delete-SOR confirm dialog title reads "Delete null?".
- Restore dialog still mentions "procurement requests" (old purchasing wording).
- Queue shows requests on deleted/lost SORs as plain OPEN, no sign the SOR is gone.
- Nina (non-purchasing member) can't reach the queue/modal at all once access is revoked: `/purchasing` is gated by access, so a kept membership is only reachable from a notification or the SOR.

## Follow-up fixes (verified in browser)
- [x] Delete dialog reads "Delete SOR-224?" (was "Delete null?")
- [x] Restore dialog: "Its Purchase Request, if it has one, carries on where it stopped."
- [x] Queue: dead SORs show "SOR DELETED" / "SOR LOST"; reference falls back to SOR Code (was "No SOR")
- [x] Revoke drops "other" memberships; Buyer (H) kept as other; 0 open SOR windows

## Rerun (2026-10-08, after 3268ab1f): 15/15 + follow-ups pass
Extra: C lost → "Revert to last stage" → "was reopened" → lost again = 3 notifications.

Bugs found and fixed:
- [x] Dialogs inside the request *modal* (from an SOR or a notification) opened behind it (z-50 vs z-70): Add from the SOR, New product, Mark as Ordered, Pick PO lines, Cancel / Cannot source / Substituted confirm, Remove member confirm. Now z-[80].
- [x] Request modal subtitle always "Purchase Request" (read client_name/opportunity_no, which pr_queue doesn't return). Now "SOR-224 · Lead" / "SOR-217 · SOR deleted".
- [x] Chat said "Member added." / "Member removed." without who. Now "Added Paolo Purchaser." / "Removed Paolo Purchaser."

Noted, not fixed:
- Nested dialogs in the modal show without a dimmed backdrop (overlay sits under the modal).
- Buyer picker label truncates: "No Buyer (back to the q…".

## #499 review follow-ups — staging SQL checks

Run on staging after the migrations land (CI applies them on merge to `staging`).
Each check runs inside `BEGIN; … ROLLBACK;` unless it says otherwise, so no data is kept.

### #502 Chat notifies only the Buyer and requesters

Paste the blocks in order into one session (psql, or the SQL editor as one run). Steps share the 502.0 fixture; any failure raises `502.x FAIL: notified {…}` and aborts the rest. Verified locally 2026-10-12 (fails 502.1 before the migration, all pass after).

502.0 Fixture (no check): a Project request with a Buyer and items. All its items are re-pointed to one requester; the Stage Action actor (creator), the requester, an author and a bystander are members, all distinct.

```sql
BEGIN;

create temp table f502 on commit drop as
with r as (
  select r.id, r.buyer_id, r.created_by from public.purchase_requests r
  where r.opportunity_id is not null and r.buyer_id is not null and r.created_by <> r.buyer_id
    and exists (select 1 from public.purchase_request_items i where i.request_id = r.id)
  limit 1
), e as (
  select e.id, row_number() over (order by e.id) n
  from public.employees e, r
  where not coalesce(e.is_deleted, false) and e.id not in (r.buyer_id, r.created_by)
  limit 3
)
select r.id req, r.buyer_id buyer, r.created_by actor,
  (select id from e where n = 1) requester,
  (select id from e where n = 2) author,
  (select id from e where n = 3) bystander
from r;

update public.purchase_request_items set requested_by = (select requester from f502)
where request_id = (select req from f502);

insert into public.purchase_request_members (request_id, employee_id, side)
select req, x, 'other' from f502, unnest(array[buyer, actor, requester, author, bystander]) x
on conflict (request_id, employee_id) do nothing;

create function pg_temp.got502(p_type text, p_tag text) returns uuid[] language sql as $$
  select coalesce(array_agg(n.recipient_id order by n.recipient_id), '{}')
  from public.notifications n, f502
  where n.reference_id = f502.req::text and n.type = p_type and n.message like '%' || p_tag || '%';
$$;
create function pg_temp.set502(variadic p uuid[]) returns uuid[] language sql as $$
  select coalesce(array_agg(x order by x), '{}') from unnest(p) x;
$$;
```

- [ ] 502.1 A plain message notifies the Buyer and the requester only. Expected: NOTICE `502.1 pass`: the Buyer and the requester are told, no one else.

```sql
do $$
declare f f502; got uuid[];
begin
  select * into f from f502;
  if f.req is null then raise exception '502: no Project request with a Buyer and items'; end if;
  insert into public.purchase_request_messages (request_id, author_id, content)
  values (f.req, f.author, 'QA 502.1 plain');
  got := pg_temp.got502('PURCHASE_REQUEST_MESSAGE', 'QA 502.1');
  if got is distinct from pg_temp.set502(f.buyer, f.requester) then
    raise exception '502.1 FAIL: notified %', got;
  end if;
  raise notice '502.1 pass';
end $$;
```

- [ ] 502.2 The Stage Action actor (neither Buyer nor requester) and a bystander member are not notified. Expected: NOTICE `502.2 pass`: the Stage Action actor and the bystander got nothing.

```sql
do $$
declare f f502; got uuid[];
begin
  select * into f from f502;
  got := pg_temp.got502('PURCHASE_REQUEST_MESSAGE', 'QA 502.1');
  if f.actor = any (got) or f.bystander = any (got) then
    raise exception '502.2 FAIL: notified %', got;
  end if;
  raise notice '502.2 pass';
end $$;
```

- [ ] 502.3 A mentioned member is still notified (once, as a mention). Expected: NOTICE `502.3 pass`: the bystander gets one mention; the message still goes to the Buyer and the requester only.

```sql
do $$
declare f f502; men uuid[]; msg uuid[];
begin
  select * into f from f502;
  insert into public.purchase_request_messages (request_id, author_id, content, metadata)
  values (f.req, f.author, 'QA 502.3 mention',
          jsonb_build_object('mentions', jsonb_build_array(jsonb_build_object('id', f.bystander))));
  men := pg_temp.got502('PURCHASE_REQUEST_MENTION', 'QA 502.3');
  msg := pg_temp.got502('PURCHASE_REQUEST_MESSAGE', 'QA 502.3');
  if men is distinct from array[f.bystander] or msg is distinct from pg_temp.set502(f.buyer, f.requester) then
    raise exception '502.3 FAIL: mention %, message %', men, msg;
  end if;
  raise notice '502.3 pass';
end $$;
```

- [ ] 502.4 With no Buyer, behaviour is unchanged: the creator and the requester are notified. Expected: NOTICE `502.4 pass`: with no Buyer, the creator and the requester are told, as before.

```sql
do $$
declare f f502; got uuid[];
begin
  select * into f from f502;
  update public.purchase_requests set buyer_id = null where id = f.req;
  insert into public.purchase_request_messages (request_id, author_id, content)
  values (f.req, f.author, 'QA 502.4 no buyer');
  got := pg_temp.got502('PURCHASE_REQUEST_MESSAGE', 'QA 502.4');
  if got is distinct from pg_temp.set502(f.actor, f.requester) then
    raise exception '502.4 FAIL: notified %', got;
  end if;
  raise notice '502.4 pass';
end $$;
```

- [ ] 502.5 A Direct request's creator is its Requester, so stays notified with a Buyer. Expected: NOTICE `502.5 pass`: a Direct request's creator (its Requester) is still told alongside the Buyer.

```sql
do $$
declare f f502; got uuid[];
begin
  select * into f from f502;
  update public.purchase_requests set buyer_id = f.buyer, opportunity_id = null, title = 'QA 502 direct'
  where id = f.req;
  insert into public.purchase_request_messages (request_id, author_id, content)
  values (f.req, f.author, 'QA 502.5 direct');
  got := pg_temp.got502('PURCHASE_REQUEST_MESSAGE', 'QA 502.5');
  if got is distinct from pg_temp.set502(f.buyer, f.actor, f.requester) then
    raise exception '502.5 FAIL: notified %', got;
  end if;
  raise notice '502.5 pass';
end $$;

ROLLBACK;
```

### #503 Deal Team can always add Requested Items

### #504 Open Purchase Request top-up

### #505 Legacy task-closing notifications

Finding: closing the old purchasing tasks sends no notifications, so nothing was
changed. `tasks` has two triggers (HR-verification guard, realtime broadcast of
the row id); neither writes `notifications`. `TASK_COMPLETED` is only sent by the
frontend on HR verification (`taskMutationService.js`), which a migration never
runs. The migration (`20261005131000`) already ran on staging; on prod it runs
with the #209 block at the manual `migrate-prod` dispatch, and needs nothing extra.
Verified locally 2026-10-12.

- [ ] 505.1 No trigger on `tasks`, `task_activity` or `notifications` sends a notification.

  ```sql
  begin;
  select c.relname as table_name, t.tgname, p.proname as function_name
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_proc p on p.oid = t.tgfoid
  where not t.tgisinternal
    and c.relnamespace = 'public'::regnamespace
    and c.relname in ('tasks', 'task_activity', 'notifications')
  order by 1, 2;
  rollback;
  ```

  Expected: exactly 2 rows, both on `tasks`: `enforce_task_verification_security`
  (`protect_task_verification`) and `tasks_broadcast_change_trigger`
  (`tasks_broadcast_change`). Any other row: stop and check it.

- [ ] 505.2 The tasks the migration closed on staging are closed, noted, and sent no notification.

  ```sql
  begin;
  select count(*) as migrated_tasks,
         count(*) filter (where coalesce(t.status, '') not in ('COMPLETED', 'DELETED', 'CANCELLED')) as not_closed,
         (select count(*)
          from public.notifications n
          join public.task_activity a2
            on a2.task_id::text = n.reference_id::text
           and a2.metadata->>'event' = 'PURCHASE_REQUEST_MIGRATED'
          where n.created_at between a2.created_at and a2.created_at + interval '5 minutes'
         ) as notifications_at_migration
  from public.task_activity a
  join public.tasks t on t.id = a.task_id
  where a.metadata->>'event' = 'PURCHASE_REQUEST_MIGRATED';
  rollback;
  ```

  Expected: `migrated_tasks` ≥ 0 (one per old purchasing task), `not_closed` = 0,
  `notifications_at_migration` = 0.

- [ ] 505.3 The migration's closing step, replayed on a seeded task, sends no notification.

  ```sql
  begin;
  create temp table c505 as select count(*) as before from public.notifications;
  with t as (
    insert into public.tasks (logged_by, task_description, project_title)
    select id, '#505 legacy purchasing task', '#505'
    from public.employees where not coalesce(is_deleted, false) limit 1
    returning id
  ), note as (
    insert into public.task_activity (task_id, author_id, type, content, metadata)
    select id, null, 'SYSTEM', 'Moved to the Purchase Request for #505. Purchasing continues there.',
           jsonb_build_object('event', 'PURCHASE_REQUEST_MIGRATED')
    from t
    returning task_id
  )
  select task_id from note;
  update public.tasks
  set status = 'COMPLETED', end_at = coalesce(end_at, now())
  where task_description = '#505 legacy purchasing task'
    and coalesce(status, '') not in ('COMPLETED', 'DELETED', 'CANCELLED');
  select (select count(*) from public.notifications) - before as new_notifications from c505;
  rollback;
  ```

  Expected: one `task_id` row, `UPDATE 1`, then `new_notifications` = 0.

### #506 RPC prefixes unified on `purchase_request_`
