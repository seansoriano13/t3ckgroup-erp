-- ============================================================================
-- Attachments on overtime / offset / SIL applications
--
-- Employees can attach supporting files when applying — an approval email, a
-- medical certificate, a photo of the logbook. Files live on Cloudinary; only
-- the descriptors are stored here, as a JSON array of
--   { "url": "...", "name": "...", "type": "...", "bytes": 123 }
-- matching the shape used by sales_opportunity_logs.metadata.attachments.
--
-- Nullable, since every existing application predates the feature and the app
-- treats attachments as optional.
-- ============================================================================

alter table public.overtime_requests add column if not exists attachments jsonb;
alter table public.offset_leaves     add column if not exists attachments jsonb;
alter table public.sil_leaves        add column if not exists attachments jsonb;

comment on column public.overtime_requests.attachments is
  'Cloudinary file descriptors supporting the application: [{url,name,type,bytes}]';
comment on column public.offset_leaves.attachments is
  'Cloudinary file descriptors supporting the application: [{url,name,type,bytes}]';
comment on column public.sil_leaves.attachments is
  'Cloudinary file descriptors supporting the application: [{url,name,type,bytes}]';
