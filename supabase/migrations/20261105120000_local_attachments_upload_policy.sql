-- Upload policy for the local-only `attachments` bucket (ticket #894).
--
-- The bucket itself is declared in supabase/config.toml, which only the local
-- CLI reads, so no staging or production project gets a bucket from this file.
-- The policy is written here because storage.objects has row-level security and
-- migrations are the only committed place for it. Without a bucket it matches
-- nothing, so it is inert on remote databases.
--
-- Idempotent: drop the name we are about to create, then create it.

drop policy if exists "attachments_insert_authenticated" on storage.objects;
create policy "attachments_insert_authenticated"
on storage.objects for insert
to authenticated
with check (bucket_id = 'attachments');
