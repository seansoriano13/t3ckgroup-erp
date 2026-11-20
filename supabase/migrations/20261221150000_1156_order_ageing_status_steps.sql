-- #1156 (spec #1151, T4): Order Monitoring and the ageing rules follow the IPAS Status.
--
-- Ageing rules
--   The seven buyer-track keys give way to the ten status keys before Done. Existing rules carry over:
--   purchase_order -> ordered, import_clearance -> customs, delivered -> delivered. The rules for
--   with_pop, received_in_odoo, create_bill and actual_checking are deleted. The four hand-off steps stay.
-- The SOR's standing facts (ipas_standing_for_sor with the stored status and its dated steps) come in the
--   #1158 migration, which already has to redefine that function for the Direct delivery flag.

alter table public.order_ageing_rules drop constraint if exists order_ageing_rules_step_chk;

delete from public.order_ageing_rules where step in ('with_pop', 'received_in_odoo', 'create_bill', 'actual_checking');

update public.order_ageing_rules set step = 'ordered' where step = 'purchase_order';
update public.order_ageing_rules set step = 'customs' where step = 'import_clearance';

insert into public.order_ageing_rules (step) values
  ('order_draft'), ('payment_approval'), ('ordered'), ('processing'), ('shipped'),
  ('in_transit'), ('customs'), ('local_hub'), ('out_for_delivery'), ('delivered'),
  ('no_transmittal'), ('check_open'), ('section_3_approval'), ('ready_to_file')
on conflict (step) do nothing;

alter table public.order_ageing_rules add constraint order_ageing_rules_step_chk check (step in (
  'order_draft', 'payment_approval', 'ordered', 'processing', 'shipped',
  'in_transit', 'customs', 'local_hub', 'out_for_delivery', 'delivered',
  'no_transmittal', 'check_open', 'section_3_approval', 'ready_to_file'
));
