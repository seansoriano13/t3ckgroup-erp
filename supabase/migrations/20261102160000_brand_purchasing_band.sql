-- Purchasing finds the brand for a Component, so Purchasing may write Brand as well as Sales.
-- Status stays with Sales.

insert into public.costing_column_bands (table_name, column_name, bands) values
  ('costing_components', 'brand', '{sales,purchasing}')
on conflict (table_name, column_name) do update set bands = excluded.bands;
