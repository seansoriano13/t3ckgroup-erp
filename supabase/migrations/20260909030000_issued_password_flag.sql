-- Issue #162/#163 — a second, real way into the portal: email + password,
-- alongside Google, on the same account. This migration adds the one piece
-- of state the reissue rule depends on: whether an employee is still signed
-- in with the password they were issued, rather than one they chose.
--
-- Set true the moment a password is issued (or reissued). Cleared the first
-- time the employee sets their own password via the provider's email
-- recovery flow. Nothing else clears it — in particular, an ordinary
-- profile update never touches this column.

alter table public.employees
  add column if not exists is_issued_password boolean not null default false;

comment on column public.employees.is_issued_password is
  'True while the employee is still on a password issued for them rather than one they chose. Set true by the manage-employee-password edge function (issue/reissue); cleared only by clear_issued_password_flag(), called by the employee themself once they set their own password. Drives whether a Super Admin reissue is permitted.';

-- Self-service clear: an authenticated employee may clear their own flag,
-- and only their own, and only to false. There is no path back to true
-- through this function — reissuing is a separate, Super-Admin-only
-- action performed server-side with the service role key.
create or replace function public.clear_issued_password_flag()
returns void
language sql
security definer
set search_path to 'public'
as $function$
  update public.employees
  set is_issued_password = false
  where email = auth.jwt() ->> 'email';
$function$;

grant execute on function public.clear_issued_password_flag() to authenticated;
