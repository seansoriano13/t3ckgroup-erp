-- 20261221130150_1153_clear_foreign_document_links.sql
--
-- Runs just before 20261221130200_1153_ipas_document_files, which copies every
-- ipas_documents.attachment_url into ipas_document_files. That table refuses a
-- link outside the app's own file store (ipas_file_link guard, #1128), so one
-- leftover test row on staging (https://example.com/...) stopped the copy and
-- every migration behind it.
--
-- A link that is not ours could never be saved since #1128; any still there is
-- old test data. Clear it so the copy can run. Clearing (null) passes the
-- ipas_documents guard, which skips a null link.

update public.ipas_documents
   set attachment_url = null
 where attachment_url is not null
   and btrim(attachment_url) <> ''
   and not public._ipas_is_own_file_link(btrim(attachment_url));
