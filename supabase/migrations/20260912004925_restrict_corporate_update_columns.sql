-- The production site submits forms with anon/authenticated and then updates
-- only the email delivery fields. Preserve INSERT while narrowing UPDATE to
-- those two operational columns; no frontend change is required.
DO $$
DECLARE
  t text;
  tables constant text[] := ARRAY[
    'agency_registration_submissions',
    'agency_support_submissions',
    'contact_submissions',
    'esim_quote_submissions',
    'exoticca_quote_submissions',
    'mega_travel_quote_submissions',
    'nature_stay_hub_submissions',
    'nefertari_quote_submissions',
    'rent_a_car_quote_submissions',
    'travel_insurance_quote_submissions',
    'traveler_services_submissions'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format(
      'REVOKE UPDATE ON TABLE corporate.%I FROM anon, authenticated',
      t
    );
    EXECUTE format(
      'GRANT UPDATE (email_status, email_error) ON TABLE corporate.%I TO anon, authenticated',
      t
    );
  END LOOP;
END
$$;
