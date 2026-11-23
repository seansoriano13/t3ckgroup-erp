-- Issue #1145 — drop the five Approval Rules switches from app_settings.
--
-- The Approval Rules tab in Settings is retired and its switches are built
-- into the code (commit 3f08b4bf; the live prod bundle carried it on
-- 2026-11-23). Nothing reads these columns any more: not the web app, not an
-- edge function, not a database function or view.
--
-- retail_storefronts stays: the odoo-sor-sync edge function reads it.
alter table public.app_settings
  drop column if exists universal_task_submission,
  drop column if exists marketing_approval_by_ops_manager,
  drop column if exists enable_self_verification,
  drop column if exists enable_bulk_approval,
  drop column if exists enable_visual_shaming;

-- Help & FAQ: remove "What is Self-Verification?" (entry t-3 in Tasks). The
-- feature it explains is gone. Matched on id and question together, so an
-- entry the FAQ Editor later gives the id t-3 is left alone. Every other
-- entry keeps its place. Re-running finds nothing and changes nothing.
update public.faq_data f
set
  categories = (
    select jsonb_agg(
      case
        when jsonb_typeof(c.elem -> 'items') = 'array' then jsonb_set(
          c.elem,
          '{items}',
          coalesce(
            (
              select jsonb_agg(i.item order by i.n)
              from jsonb_array_elements(c.elem -> 'items') with ordinality as i(item, n)
              where not (
                coalesce(i.item ->> 'id', '') = 't-3'
                and coalesce(i.item ->> 'q', '') ilike '%self-verification%'
              )
            ),
            '[]'::jsonb
          )
        )
        else c.elem
      end
      order by c.n
    )
    from jsonb_array_elements(f.categories) with ordinality as c(elem, n)
  ),
  updated_at = now()
where jsonb_typeof(f.categories) = 'array'
  and exists (
    select 1
    from jsonb_array_elements(f.categories) as c(elem)
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(c.elem -> 'items') = 'array' then c.elem -> 'items' else '[]'::jsonb end
    ) as i(item)
    where i.item ->> 'id' = 't-3'
      and coalesce(i.item ->> 'q', '') ilike '%self-verification%'
  );
