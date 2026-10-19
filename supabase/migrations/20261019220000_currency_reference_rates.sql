-- Reference Rate (#317): the PHP value of one unit of a foreign currency on a given day.
--
-- Fetched once a day by the currency-rates-fetch edge function. Used in exactly two places:
-- it pre-fills a foreign Canvass Offer's comparison rate (the typed value is what is stored),
-- and it is shown beside an IPAS payment's typed rate as context, flagging a wide divergence.
-- It never fills a payment and never reaches Landed Cost (#218).
--
-- Always dated, never live: a failed fetch writes nothing, so reference_rate() keeps
-- returning the last good row under its own, older date.
--
-- DEPLOY ORDER: deploy the currency-rates-fetch function (verify_jwt = false) first; the cron
-- job reads project_url and cron_secret from Vault like the other jobs (20261005120000).
-- SAFE TO RUN AT ANY TIME.

create table if not exists public.currency_rate_currencies (
  currency text primary key check (currency ~ '^[A-Z]{3}$' and currency <> 'PHP'),
  -- how far (percent) an IPAS payment's typed rate may sit from the Reference Rate before it is flagged
  divergence_pct numeric not null default 2 check (divergence_pct > 0),
  created_at timestamptz not null default now()
);

insert into public.currency_rate_currencies (currency) values ('USD'), ('EUR')
on conflict (currency) do nothing;

create table if not exists public.currency_rates (
  id uuid primary key default gen_random_uuid(),
  currency text not null references public.currency_rate_currencies (currency) on update cascade,
  rate_date date not null,
  php_per_unit numeric not null check (php_per_unit > 0),
  source text not null,
  fetched_at timestamptz not null default now(),
  overridden_by uuid references public.employees (id),
  overridden_at timestamptz,
  replaced_php_per_unit numeric,
  constraint currency_rates_currency_day_key unique (currency, rate_date)
);

alter table public.currency_rate_currencies enable row level security;
alter table public.currency_rates enable row level security;

drop policy if exists currency_rate_currencies_read on public.currency_rate_currencies;
create policy currency_rate_currencies_read on public.currency_rate_currencies
  for select to authenticated using (true);

drop policy if exists currency_rates_read on public.currency_rates;
create policy currency_rates_read on public.currency_rates
  for select to authenticated using (true);

-- No write policies: rows arrive only through the two functions below.
revoke insert, update, delete on public.currency_rates, public.currency_rate_currencies from anon, authenticated;

-- The daily fetch's write. Refreshes a fetched day; never touches an overridden one.
create or replace function public.record_currency_rate(
  p_currency text,
  p_rate_date date,
  p_php_per_unit numeric,
  p_source text
)
returns void
language sql
security definer
set search_path to ''
as $function$
  insert into public.currency_rates (currency, rate_date, php_per_unit, source, fetched_at)
  values (upper(p_currency), p_rate_date, p_php_per_unit, p_source, now())
  on conflict (currency, rate_date) do update
    set php_per_unit = excluded.php_per_unit,
        source = excluded.source,
        fetched_at = excluded.fetched_at
    where public.currency_rates.overridden_at is null;
$function$;

revoke all on function public.record_currency_rate(text, date, numeric, text) from public, anon, authenticated;
grant execute on function public.record_currency_rate(text, date, numeric, text) to service_role;

-- A Super Admin's correction of one day's rate, recorded with who, when and what it replaced.
create or replace function public.override_currency_rate(
  p_currency text,
  p_rate_date date,
  p_php_per_unit numeric
)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if not coalesce(public.is_super_admin(), false) then
    raise exception 'Only a Super Admin can override a Reference Rate.' using errcode = '42501';
  end if;
  if p_php_per_unit is null or p_php_per_unit <= 0 then
    raise exception 'A Reference Rate must be more than zero.' using errcode = '22023';
  end if;

  -- Currencies are added on demand: overriding one starts fetching it too.
  insert into public.currency_rate_currencies (currency) values (upper(p_currency))
  on conflict (currency) do nothing;

  insert into public.currency_rates
    (currency, rate_date, php_per_unit, source, overridden_by, overridden_at, replaced_php_per_unit)
  values
    (upper(p_currency), p_rate_date, p_php_per_unit, 'override', public.get_employee_id(), now(), null)
  on conflict (currency, rate_date) do update
    set replaced_php_per_unit = case
          when public.currency_rates.overridden_at is null then public.currency_rates.php_per_unit
          else public.currency_rates.replaced_php_per_unit
        end,
        php_per_unit = excluded.php_per_unit,
        source = 'override',
        overridden_by = excluded.overridden_by,
        overridden_at = excluded.overridden_at;
end;
$function$;

revoke all on function public.override_currency_rate(text, date, numeric) from public, anon;
grant execute on function public.override_currency_rate(text, date, numeric) to authenticated;

-- The rate to show for a day: the latest on or before it, carrying its own date.
create or replace function public.reference_rate(p_currency text, p_on date)
returns table (
  currency text,
  rate_date date,
  php_per_unit numeric,
  source text,
  overridden boolean,
  divergence_pct numeric
)
language sql
stable
security invoker
set search_path to ''
as $function$
  select r.currency, r.rate_date, r.php_per_unit, r.source, r.overridden_at is not null, c.divergence_pct
  from public.currency_rates r
  join public.currency_rate_currencies c on c.currency = r.currency
  where r.currency = upper(p_currency) and r.rate_date <= p_on
  order by r.rate_date desc
  limit 1;
$function$;

grant execute on function public.reference_rate(text, date) to authenticated;

-- Once a day, after the ECB publishes (about 16:00 CET), at 08:00 Manila the next morning.
create or replace function public.invoke_currency_rates_fetch()
returns bigint
language sql
security definer
set search_path to ''
as $function$
  select public.invoke_cron_edge_function('currency-rates-fetch');
$function$;

revoke all on function public.invoke_currency_rates_fetch() from public, anon, authenticated;

create extension if not exists pg_cron with schema extensions;

select cron.unschedule(jobname) from cron.job where jobname = 'currency-rates-daily';

select cron.schedule(
  'currency-rates-daily',
  '0 0 * * *', -- 00:00 UTC = 08:00 Manila
  $$select public.invoke_currency_rates_fetch();$$
);
