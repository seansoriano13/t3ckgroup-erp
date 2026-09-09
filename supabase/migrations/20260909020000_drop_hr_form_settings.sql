-- Issue #153: the typed-name settings singleton this table backed
-- ("Approved by"/"Noted by" names typed once and printed on every form,
-- never signed) is replaced by the real head-approval and HR-processing
-- identities the forms already carry (head_id, hr_processed_by). Both
-- plates now draw from a person who actually acted, so the settings table
-- and its editing screen (FormSettingsConfig.jsx, removed alongside this
-- migration) are no longer read by anything.
drop table if exists public.hr_form_settings;
