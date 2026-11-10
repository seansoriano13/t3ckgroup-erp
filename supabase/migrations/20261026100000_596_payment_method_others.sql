-- #596 (spec #595): the payment method "Other" reads "Others", as on the sheet.
--
-- Options are referenced by id (ipas_payments.method_id), so renaming the row
-- is enough: every payment already recorded with it follows. Skipped when the
-- list already has an "Others" (the unique label index would refuse), and
-- idempotent: a second run finds no "Other" left to rename. The freight
-- service "Other" is a different list and is left alone.

update public.ipas_options o
   set label = 'Others'
 where o.list = 'payment_method'
   and lower(btrim(o.label)) = 'other'
   and not exists (
     select 1 from public.ipas_options x
      where x.list = 'payment_method' and lower(btrim(x.label)) = 'others'
   );
