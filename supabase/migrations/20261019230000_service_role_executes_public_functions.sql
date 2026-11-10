-- The service role may run every public function, as it already can on the hosted projects.
--
-- Hosted Supabase gives service_role EXECUTE on new public functions through its default
-- privileges, so `revoke all ... from public, anon, authenticated` leaves service_role able to
-- call them (checked on staging: no public function is closed to it). The local CLI stack does
-- not, so the same revoke there locked service_role out of ~290 functions, including the ones a
-- column default or CHECK calls (ipas_format_number, _ipas_signoff_pair_ok). A service-role
-- insert into ipas or ipas_signoffs then failed with 42501 instead of reaching the constraint the
-- policy tests assert (56-ipas-raise, 61-ipas-signoffs, 92-canvass-po-suppliers).
--
-- A no-op on staging and prod. SAFE TO RUN AT ANY TIME.

grant execute on all functions in schema public to service_role;

alter default privileges in schema public grant execute on functions to service_role;
