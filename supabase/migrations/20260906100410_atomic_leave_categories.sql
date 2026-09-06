CREATE OR REPLACE FUNCTION reorder_leave_categories(p_ordering jsonb)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  item record;
BEGIN
  -- First, stage them to negative values to avoid unique constraint violations
  FOR item IN SELECT * FROM jsonb_to_recordset(p_ordering) AS x(id uuid, sort_order int) LOOP
    UPDATE hr_leave_categories SET sort_order = -item.sort_order WHERE id = item.id;
  END LOOP;
  
  -- Then update them to their final values
  FOR item IN SELECT * FROM jsonb_to_recordset(p_ordering) AS x(id uuid, sort_order int) LOOP
    UPDATE hr_leave_categories SET sort_order = item.sort_order, updated_at = now() WHERE id = item.id;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION add_leave_category(p_label text)
RETURNS hr_leave_categories
LANGUAGE plpgsql
AS $$
DECLARE
  v_result hr_leave_categories;
BEGIN
  -- Lock the table to prevent concurrent inserts from seeing the same max sort_order
  LOCK TABLE hr_leave_categories IN EXCLUSIVE MODE;
  
  INSERT INTO hr_leave_categories (label, sort_order, is_active)
  VALUES (
    p_label,
    (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM hr_leave_categories),
    true
  )
  RETURNING * INTO v_result;
  
  RETURN v_result;
END;
$$;
