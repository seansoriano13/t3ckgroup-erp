-- Migration: odoo_retail_queue
-- Queue-gated approval layer between Odoo auto-sync and the SOR.
-- Shopee retail orders land here first; a sales user approves to create the real SOR entry.

CREATE TABLE public.odoo_retail_queue (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  -- Odoo source data (immutable after insert by the sync job)
  odoo_so_number        text        NOT NULL UNIQUE,  -- e.g. "S08286"
  odoo_so_id            integer     NOT NULL,
  odoo_partner_name     text        NOT NULL,          -- "Shopee T3ck Outdoor"
  odoo_person_name      text,                          -- parsed buyer name from Shopee activity note
  odoo_amount           numeric     NOT NULL,
  odoo_salesperson_name text,                          -- user_id[1] from Odoo sale.order
  odoo_date_order       timestamptz,
  odoo_create_date      timestamptz,

  -- Review state
  status                text        NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'approved', 'dismissed')),
  reviewed_by           uuid        REFERENCES public.employees(id),
  reviewed_at           timestamptz,

  -- Editable SOR fields (pre-filled from Odoo, sales may change before approving)
  client_name           text,
  contact_person        text,
  expected_value        numeric,
  lead_source           text        DEFAULT 'SHOPEE',
  project_title         text,
  deal_owner_id         uuid        REFERENCES public.employees(id),
  sales_director_id     uuid        REFERENCES public.employees(id),

  -- Link back to the SOR entry once approved
  opportunity_id        uuid        REFERENCES public.sales_opportunities(id)
);

-- Auto-update updated_at on row change
CREATE OR REPLACE FUNCTION public.set_odoo_retail_queue_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_odoo_retail_queue_updated_at
  BEFORE UPDATE ON public.odoo_retail_queue
  FOR EACH ROW EXECUTE FUNCTION public.set_odoo_retail_queue_updated_at();

-- Useful indexes
CREATE INDEX odoo_retail_queue_status_idx ON public.odoo_retail_queue (status);
CREATE INDEX odoo_retail_queue_created_at_idx ON public.odoo_retail_queue (created_at DESC);

-- RLS: Sales users can read and update (approve/dismiss).
-- The edge function uses the service role key and bypasses RLS.
ALTER TABLE public.odoo_retail_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Sales can view queue"
  ON public.odoo_retail_queue FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Sales can update queue items"
  ON public.odoo_retail_queue FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);
