-- #806 (parent #799): only a terminal Stage with outcome Lost counts as Lost.
-- An unset outcome used to mean lost; it now means neither. So every terminal
-- Stage named "Closed Lost" gets outcome 'lost' explicitly.
-- Update only, never a delete. Idempotent. Stages already set are left alone.

update public.flow_stages
set terminal_outcome = 'lost'
where is_terminal
  and name = 'Closed Lost'
  and terminal_outcome is null;

-- Flow Snapshots carry their own copy of each Stage, and lost checks read the
-- snapshot. Set the same outcome inside every snapshot's stages array.
update public.flow_snapshots fs
set snapshot_data = jsonb_set(
  fs.snapshot_data,
  '{stages}',
  (
    select jsonb_agg(
      case
        when (st->>'is_terminal')::boolean is true
          and st->>'name' = 'Closed Lost'
          and coalesce(st->>'terminal_outcome', '') = ''
        then st || jsonb_build_object('terminal_outcome', 'lost')
        else st
      end
      order by ord
    )
    from jsonb_array_elements(fs.snapshot_data->'stages') with ordinality as t(st, ord)
  )
)
where jsonb_typeof(fs.snapshot_data->'stages') = 'array'
  and exists (
    select 1
    from jsonb_array_elements(fs.snapshot_data->'stages') st
    where (st->>'is_terminal')::boolean is true
      and st->>'name' = 'Closed Lost'
      and coalesce(st->>'terminal_outcome', '') = ''
  );
