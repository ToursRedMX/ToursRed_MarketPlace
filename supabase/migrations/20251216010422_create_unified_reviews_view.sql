
-- Eliminar vista si existe
DROP VIEW IF EXISTS admin_reviews_view;

-- Crear vista unificada
CREATE VIEW admin_reviews_view AS
-- Reseñas de tours
SELECT 
  r.id,
  r.user_id,
  r.tour_id,
  r.agency_id,
  NULL::uuid as traveler_id,
  NULL::uuid as booking_id,
  r.rating,
  r.comment,
  r.reply,
  r.is_visible,
  r.created_at,
  r.updated_at,
  'tour'::text as review_type,
  
  -- Datos del usuario/viajero
  u.first_name as user_first_name,
  u.last_name as user_last_name,
  u.email as user_email,
  
  -- Datos del tour
  t.name as tour_name,
  t.destination as tour_destination,
  t.image_url as tour_image_url,
  
  -- Datos de la agencia
  a.name as agency_name
FROM reviews r
LEFT JOIN users u ON r.user_id = u.id
LEFT JOIN tours t ON r.tour_id = t.id
LEFT JOIN agencies a ON r.agency_id = a.id

UNION ALL

-- Reseñas de agencias
SELECT 
  ar.id,
  NULL::uuid as user_id,
  b.tour_id,
  ar.agency_id,
  ar.traveler_id,
  ar.booking_id,
  ar.rating,
  ar.comment,
  ar.reply,
  ar.is_visible,
  ar.created_at,
  ar.updated_at,
  'agency'::text as review_type,
  
  -- Datos del usuario/viajero
  u.first_name as user_first_name,
  u.last_name as user_last_name,
  u.email as user_email,
  
  -- Datos del tour (a través de booking)
  t.name as tour_name,
  t.destination as tour_destination,
  t.image_url as tour_image_url,
  
  -- Datos de la agencia
  a.name as agency_name
FROM agency_reviews ar
LEFT JOIN users u ON ar.traveler_id = u.id
LEFT JOIN bookings b ON ar.booking_id = b.id
LEFT JOIN tours t ON b.tour_id = t.id
LEFT JOIN agencies a ON ar.agency_id = a.id

UNION ALL

-- Reseñas de viajeros
SELECT 
  tr.id,
  NULL::uuid as user_id,
  b.tour_id,
  tr.agency_id,
  tr.traveler_id,
  tr.booking_id,
  tr.rating,
  tr.comment,
  NULL::text as reply,
  tr.is_visible,
  tr.created_at,
  tr.updated_at,
  'traveler'::text as review_type,
  
  -- Datos del usuario/viajero
  u.first_name as user_first_name,
  u.last_name as user_last_name,
  u.email as user_email,
  
  -- Datos del tour (a través de booking)
  t.name as tour_name,
  t.destination as tour_destination,
  t.image_url as tour_image_url,
  
  -- Datos de la agencia
  a.name as agency_name
FROM traveler_reviews tr
LEFT JOIN users u ON tr.traveler_id = u.id
LEFT JOIN bookings b ON tr.booking_id = b.id
LEFT JOIN tours t ON b.tour_id = t.id
LEFT JOIN agencies a ON tr.agency_id = a.id;

-- Dar permisos de lectura a usuarios autenticados (para admin)
GRANT SELECT ON admin_reviews_view TO authenticated;
GRANT SELECT ON admin_reviews_view TO anon;
