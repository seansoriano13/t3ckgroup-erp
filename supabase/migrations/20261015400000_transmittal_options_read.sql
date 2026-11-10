-- The Transmittal staff lists read the slip's option lists (spec #251, browser
-- walkthrough of #252).
--
-- `ipas_options_read` gated every row on `ipas_can_read()`, which leaves out
-- the four transmittal_* lists on purpose (they must not read the IPAS). So a
-- Warehouse or Logistics preparer saw no Product, Reference Checklist or Item
-- Location to tick, and Technical saw the slip's ticks blank. They now read
-- those three lists only; payment methods, charge kinds and the rest stay
-- with IPAS readers. Each helper sits in a scalar subquery so it runs once
-- per query, not once per row.

drop policy if exists ipas_options_read on public.ipas_options;
create policy ipas_options_read on public.ipas_options
  for select to authenticated
  using (
    (select public.ipas_can_read())
    or (
      list in ('transmittal_product', 'transmittal_reference', 'item_location')
      and (
        select public.transmittal_on_list('transmittal_warehouse')
            or public.transmittal_on_list('transmittal_technical')
            or public.transmittal_on_list('transmittal_logistics')
            or public.transmittal_on_list('transmittal_check_by')
      )
    )
  );
