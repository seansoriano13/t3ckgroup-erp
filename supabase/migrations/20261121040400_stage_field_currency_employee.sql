-- Ticket #893 (spec #907, decision 7) — Stage Fields get two more types:
--
--   * `currency` — a number shown as pesos (₱). Stored as a JSON number.
--   * `employee` — a picker of employees. Stored as the employee id.
--
-- The Project flows' typed money and people fields become those types, so an
-- amount can be compared to the Final Offer and a name can be notified or
-- reported:
--
--   NOA Amount                              -> currency
--   Purchasing Involved                     -> employee
--   Logistics Representative                -> employee
--   Representative                          -> employee
--
-- Only the field's type changes. Its label, its Stage, and every saved value
-- stay as they are: a value saved as typed text (for example
-- "1,370,535.74 pesos") is kept as read-only history. The app shows it as it
-- was saved and never reinterprets it as a number or an employee.
--
-- Written so a re-run cannot fail: the check is dropped by name if present,
-- then re-created with the full list, and the type update is idempotent.

alter table public.flow_stage_fields drop constraint if exists flow_stage_fields_type_chk;
alter table public.flow_stage_fields
  add constraint flow_stage_fields_type_chk check (
    field_type in ('text', 'number', 'date', 'choice', 'currency', 'employee')
  );

update public.flow_stage_fields f
set field_type = case
      when lower(btrim(f.label)) = 'noa amount' then 'currency'
      else 'employee'
    end,
    updated_at = now()
from public.flow_stages s
join public.sales_flows sf on sf.id = s.flow_id
join public.sale_types st on st.id = sf.sale_type_id
where s.id = f.stage_id
  and lower(btrim(st.name)) = 'project'
  and f.source = 'custom'
  and f.field_type is distinct from case
        when lower(btrim(f.label)) = 'noa amount' then 'currency'
        else 'employee'
      end
  and lower(btrim(f.label)) in (
    'noa amount',
    'purchasing involved',
    'logistics representative',
    'representative'
  );
