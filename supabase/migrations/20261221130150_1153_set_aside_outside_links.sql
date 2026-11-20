-- 20261221130150_1153_set_aside_outside_links.sql
-- Runs just before 20261221130200_1153_ipas_document_files.sql (spec #1151, T7).
--
-- #1153 copies every ipas_documents.attachment_url into ipas_document_files, and that table refuses a
-- link outside the app's own file store (the #1128 check). An older document can still hold such a link
-- (saved before #1128, or a test row), and one is enough to stop the whole #1153 migration.
--
-- So, before the copy: each outside link is written to the IPAS history as `document_link_set_aside`
-- (the document and the link, so nothing is lost), then the document's attachment_url is cleared.
-- The document itself stays; it simply has no file, as if none had been attached.
--
-- The filed-IPAS freeze is paused only around the clear, as in 20261201120000_954 (ipas_freeze).

insert into public.ipas_events (ipas_id, actor_id, kind, detail)
select d.ipas_id,
       null,
       'document_link_set_aside',
       jsonb_build_object('document_id', d.id, 'url', btrim(d.attachment_url), 'reason', 'outside the file store (#1153)')
  from public.ipas_documents d
 where d.attachment_url is not null
   and btrim(d.attachment_url) <> ''
   and not public._ipas_is_own_file_link(btrim(d.attachment_url));

alter table public.ipas_documents disable trigger ipas_documents_freeze;

update public.ipas_documents d
   set attachment_url = null
 where d.attachment_url is not null
   and btrim(d.attachment_url) <> ''
   and not public._ipas_is_own_file_link(btrim(d.attachment_url));

alter table public.ipas_documents enable trigger ipas_documents_freeze;
