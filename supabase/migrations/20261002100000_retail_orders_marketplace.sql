-- Retail: retail_orders.storefront -> marketplace (#449).
-- Marketplace = Shopee/Lazada; Storefront = the Odoo customer (partner_name).
-- Staging only: prod has no retail_orders.

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'retail_orders' and column_name = 'storefront'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'retail_orders' and column_name = 'marketplace'
  ) then
    alter table public.retail_orders rename column storefront to marketplace;
  end if;
end $$;

comment on column public.retail_orders.marketplace is
  'Marketplace the order came through (Shopee/Lazada). The Odoo customer is partner_name.';
