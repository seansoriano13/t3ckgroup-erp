# Closed Won impact queries

Read-only. Run on staging, then prod, before `20261005132000_terminal_stage_outcome.sql` applies (merging to `staging` applies it there; prod runs only via the manual migrate-prod workflow).

```sql
-- Impact of 20261005132000_terminal_stage_outcome.sql. Read-only: run BEFORE the
-- migration, against staging and then prod.

-- 1. Every Terminal Stage, and what it will end as after the migration.
select st.name                                      as sale_type,
       s.name                                       as stage,
       (f.won_stage_id = s.id)                      as is_won_stage,
       case
         when f.won_stage_id = s.id                 then 'won (the Won Stage)'
         when btrim(s.name) ~* '^closed won$'       then 'won  <- changes'
         else 'lost (as today)'
       end                                          as after_migration,
       (select count(*) from sales_opportunities o
         where o.flow_stage_id = s.id and not coalesce(o.is_deleted, false)) as sors_here
from flow_stages s
join sales_flows f  on f.id = s.flow_id
join sale_types st  on st.id = f.sale_type_id
where s.is_terminal
order by 1, 2;

-- 2. SORs that move from "lost" to Won / Realized: on a Closed Won Stage today.
select st.name                    as sale_type,
       count(*)                   as sors,
       sum(o.expected_value)      as expected_value,
       count(o.contract_date)     as with_contract_date
from sales_opportunities o
join flow_stages s  on s.id = o.flow_stage_id
join sales_flows f  on f.id = s.flow_id
join sale_types st  on st.id = f.sale_type_id
where s.is_terminal
  and s.id is distinct from f.won_stage_id
  and btrim(s.name) ~* '^closed won$'
  and not coalesce(o.is_deleted, false)
group by 1
order by 1;

-- 3. The same SORs, one per row, to check by hand.
select coalesce(nullif(o.sales_reference, ''), o.sor_code) as sor,
       o.project_title, st.name as sale_type, s.name as stage,
       o.expected_value, o.contract_date
from sales_opportunities o
join flow_stages s  on s.id = o.flow_stage_id
join sales_flows f  on f.id = s.flow_id
join sale_types st  on st.id = f.sale_type_id
where s.is_terminal
  and s.id is distinct from f.won_stage_id
  and btrim(s.name) ~* '^closed won$'
  and not coalesce(o.is_deleted, false)
order by st.name, o.expected_value desc;

-- 4. Terminal Stages NOT named Closed Won that hold deals: if any of these is
--    really a win under another name ("Completed", "Closed - Won"), it stays
--    lost until set to Won in Flow Canvas.
select st.name as sale_type, s.name as stage, count(o.id) as sors
from flow_stages s
join sales_flows f  on f.id = s.flow_id
join sale_types st  on st.id = f.sale_type_id
left join sales_opportunities o on o.flow_stage_id = s.id and not coalesce(o.is_deleted, false)
where s.is_terminal
  and s.id is distinct from f.won_stage_id
  and not btrim(s.name) ~* '^closed won$'
group by 1, 2
order by 1, 2;
```
