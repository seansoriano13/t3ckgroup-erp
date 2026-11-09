-- #936 (spec #927): a section's required documents are checked at EVERY sign-off of
-- that section, not only the first. Before, Approve, Noted, Checked and Approved (file)
-- never looked, and a file removed after "Send for signing" slipped through.
-- Stored sections 1, 3, 6 and 7 (screens 1 to 4); _ipas_missing_documents (#711) names
-- what is lacking and is unchanged. The refusal names the missing documents.
-- Idempotent: create or replace.

create or replace function public._ipas_signoff_documents_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_missing jsonb;
begin
  if new.section in (1, 3, 6, 7) then
    v_missing := public._ipas_missing_documents(new.ipas_id, new.section::integer);
    if jsonb_array_length(v_missing) > 0 then
      raise exception 'ipas_sign: section % needs % first',
        public._ipas_section_no(new.section::integer),
        (select string_agg(x, ', ') from jsonb_array_elements_text(v_missing) as x)
        using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public._ipas_signoff_documents_guard() from public, anon, authenticated;
