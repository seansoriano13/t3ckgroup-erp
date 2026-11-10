-- #552 (spec #544): IPAS sign-off sections read 1, 2, 4 wherever people see
-- them, as the IPAS screen numbers them. The stored sections (1, 3, 7) and the
-- signer list keys do not change. Notifications already written say "section 3"
-- and "section 7"; rewrite their text to the display numbers. Re-runnable: each
-- replacement only matches the old wording.

update public.notifications
set message = replace(
      replace(
        replace(message,
          'sections 1 and 3 are approved. Section 7 is ready for Received.',
          'sections 1 and 2 are approved. Section 4 is ready for Received.'),
        'Section 7 is ready for Noted and Checked.',
        'Section 4 is ready for Noted and Checked.'),
      'Approved in section 7 files the IPAS.',
      'Approved in section 4 files the IPAS.')
where type = 'IPAS_SECTION_7_READY'
  and (message like '%sections 1 and 3 are approved. Section 7 is ready for Received.%'
    or message like '%Section 7 is ready for Noted and Checked.%'
    or message like '%Approved in section 7 files the IPAS.%');

update public.notifications
set message = replace(message, 'section 3 (Purchasing & Finance)', 'section 2 (Purchasing & Finance)')
where type = 'IPAS_SIGNOFF_READY'
  and message like '%section 3 (Purchasing & Finance)%';
