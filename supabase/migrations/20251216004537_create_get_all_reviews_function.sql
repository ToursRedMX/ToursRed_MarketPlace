-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20251216004537
--   name:    create_get_all_reviews_function
--
-- Recuperado : las sentencias ejecutadas, en su orden original.
-- Perdido    : los comentarios sueltos entre sentencias. El ledger guarda solo
--              sentencias ejecutables, asi que la documentacion que tuviera el
--              archivo original no es recuperable desde aqui.
-- Transformado: saltos de linea desescapados y ';' separadores repuestos, que
--              statements[] no conserva. La alineacion puede diferir.
--
-- Se agrega para que el cambio de esquema sea revisable y reproducible desde
-- el repo. Para el detalle de por que existe, ver el bullet del desfase de
-- migraciones en claude.md.
-- ============================================================================


/*
  # Create function to get all reviews with complete details

  This function loads all agency and traveler reviews with their related tour, user, and agency information in a single query.
  
  Returns:
  - all reviews (agency and traveler) with:
    - review data
    - tour name, destination, image_url
    - traveler/user first_name, last_name, email
    - agency name
    - review_type: 'agency' or 'traveler'
*/

CREATE OR REPLACE FUNCTION get_all_reviews_with_details()
RETURNS TABLE(
  id uuid,
  booking_id uuid,
  agency_id uuid,
  traveler_id uuid,
  rating integer,
  comment text,
  created_at timestamptz,
  updated_at timestamptz,
  is_visible boolean,
  reply text,
  tour_name text,
  tour_destination text,
  tour_image_url text,
  user_first_name text,
  user_last_name text,
  user_email text,
  agency_name text,
  review_type text
) AS $$
SELECT
  ar.id,
  ar.booking_id,
  ar.agency_id,
  ar.traveler_id,
  ar.rating,
  ar.comment,
  ar.created_at,
  ar.updated_at,
  ar.is_visible,
  ar.reply,
  t.name as tour_name,
  t.destination as tour_destination,
  t.image_url as tour_image_url,
  u.first_name as user_first_name,
  u.last_name as user_last_name,
  u.email as user_email,
  a.name as agency_name,
  'agency'::text as review_type
FROM agency_reviews ar
LEFT JOIN bookings b ON ar.booking_id = b.id
LEFT JOIN tours t ON b.tour_id = t.id
LEFT JOIN users u ON ar.traveler_id = u.id
LEFT JOIN agencies a ON ar.agency_id = a.id
UNION ALL
SELECT
  tr.id,
  tr.booking_id,
  tr.agency_id,
  tr.traveler_id,
  tr.rating,
  tr.comment,
  tr.created_at,
  tr.updated_at,
  tr.is_visible,
  NULL as reply,
  t.name as tour_name,
  t.destination as tour_destination,
  t.image_url as tour_image_url,
  u.first_name as user_first_name,
  u.last_name as user_last_name,
  u.email as user_email,
  a.name as agency_name,
  'traveler'::text as review_type
FROM traveler_reviews tr
LEFT JOIN bookings b ON tr.booking_id = b.id
LEFT JOIN tours t ON b.tour_id = t.id
LEFT JOIN users u ON tr.traveler_id = u.id
LEFT JOIN agencies a ON tr.agency_id = a.id
ORDER BY created_at DESC
;


$$ LANGUAGE SQL STABLE
;



;
