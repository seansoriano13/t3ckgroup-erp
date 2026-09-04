-- ==============================================================================
-- 0072_employee_signatures.sql
--
-- Ticket #62: an employee draws or uploads a signature once, in their
-- profile. `signature_path` on `employees` always points at the CURRENT
-- version; replacing it writes a new path and leaves the old file alone, so
-- a document signed months ago can still render the signature actually used
-- at the time (once something records which version it signed with).
--
-- The `signatures` bucket and its policies were already applied by hand to
-- staging ahead of this migration, to unblock earlier design work. This
-- migration is idempotent so it is safe to (re)apply to both staging and
-- production, and it is what makes the bucket a tracked, reviewable part of
-- the repo rather than something that only ever lived in the live database.
-- ==============================================================================

alter table public.employees add column if not exists signature_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('signatures', 'signatures', false, 204800, array['image/png'])
on conflict (id) do nothing;

-- Path convention: `<employeeId>/<version>.png` — the first path segment is
-- the owning employee's id, which is what every policy below keys off.

drop policy if exists "signatures_insert_own" on storage.objects;
create policy "signatures_insert_own"
on storage.objects for insert
with check (
  bucket_id = 'signatures'
  and (storage.foldername(name))[1] = get_employee_id()::text
);

drop policy if exists "signatures_select_own_or_hr" on storage.objects;
create policy "signatures_select_own_or_hr"
on storage.objects for select
using (
  bucket_id = 'signatures'
  and (
    (storage.foldername(name))[1] = get_employee_id()::text
    or exists (
      select 1 from public.employees e
      where e.id = get_employee_id() and (e.is_hr or e.is_super_admin)
    )
  )
);

drop policy if exists "signatures_update_own" on storage.objects;
create policy "signatures_update_own"
on storage.objects for update
using (
  bucket_id = 'signatures'
  and (storage.foldername(name))[1] = get_employee_id()::text
)
with check (
  bucket_id = 'signatures'
  and (storage.foldername(name))[1] = get_employee_id()::text
);

drop policy if exists "signatures_delete_own" on storage.objects;
create policy "signatures_delete_own"
on storage.objects for delete
using (
  bucket_id = 'signatures'
  and (storage.foldername(name))[1] = get_employee_id()::text
);
