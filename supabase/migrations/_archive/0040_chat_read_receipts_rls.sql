
-- Enable RLS for chat_read_receipts
alter table public.chat_read_receipts enable row level security;

-- Allow authenticated users to view all read receipts
create policy "chat_read_receipts_select_all"
on public.chat_read_receipts
for select
to authenticated
using (true);

-- Allow authenticated users to insert/update their own read receipts
create policy "chat_read_receipts_insert_own"
on public.chat_read_receipts
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "chat_read_receipts_update_own"
on public.chat_read_receipts
for update
to authenticated
using (auth.uid() = user_id);

-- Enable realtime for chat_read_receipts
alter publication supabase_realtime add table public.chat_read_receipts;

