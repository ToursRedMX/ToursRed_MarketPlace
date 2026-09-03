-- ============================================================================
-- ADMIN REVIEWS VIEW - Add admin check
-- ============================================================================

DROP VIEW IF EXISTS public.admin_reviews_view;

CREATE VIEW public.admin_reviews_view 
WITH (security_invoker = false) -- Keep SECURITY DEFINER behavior
AS
-- Only return data if the current user is an admin
SELECT 
  r.id,
  r.user_id,
  r.tour_id,
  r.agency_id,
  NULL::uuid AS traveler_id,
  NULL::uuid AS booking_id,
  r.rating,
  r.comment,
  r.reply,
  r.is_visible,
  r.created_at,
  r.updated_at,
  'tour'::text AS review_type,
  u.first_name AS user_first_name,
  u.last_name AS user_last_name,
  u.email AS user_email,
  t.name AS tour_name,
  t.destination AS tour_destination,
  t.image_url AS tour_image_url,
  a.name AS agency_name
FROM reviews r
LEFT JOIN users u ON r.user_id = u.id
LEFT JOIN tours t ON r.tour_id = t.id
LEFT JOIN agencies a ON r.agency_id = a.id
WHERE EXISTS (
  SELECT 1 FROM users 
  WHERE id = auth.uid() 
  AND role = 'admin'
)

UNION ALL

SELECT 
  ar.id,
  NULL::uuid AS user_id,
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
  'agency'::text AS review_type,
  u.first_name AS user_first_name,
  u.last_name AS user_last_name,
  u.email AS user_email,
  t.name AS tour_name,
  t.destination AS tour_destination,
  t.image_url AS tour_image_url,
  a.name AS agency_name
FROM agency_reviews ar
LEFT JOIN users u ON ar.traveler_id = u.id
LEFT JOIN bookings b ON ar.booking_id = b.id
LEFT JOIN tours t ON b.tour_id = t.id
LEFT JOIN agencies a ON ar.agency_id = a.id
WHERE EXISTS (
  SELECT 1 FROM users 
  WHERE id = auth.uid() 
  AND role = 'admin'
)

UNION ALL

SELECT 
  tr.id,
  NULL::uuid AS user_id,
  b.tour_id,
  tr.agency_id,
  tr.traveler_id,
  tr.booking_id,
  tr.rating,
  tr.comment,
  NULL::text AS reply,
  tr.is_visible,
  tr.created_at,
  tr.updated_at,
  'traveler'::text AS review_type,
  u.first_name AS user_first_name,
  u.last_name AS user_last_name,
  u.email AS user_email,
  t.name AS tour_name,
  t.destination AS tour_destination,
  t.image_url AS tour_image_url,
  a.name AS agency_name
FROM traveler_reviews tr
LEFT JOIN users u ON tr.traveler_id = u.id
LEFT JOIN bookings b ON tr.booking_id = b.id
LEFT JOIN tours t ON b.tour_id = t.id
LEFT JOIN agencies a ON tr.agency_id = a.id
WHERE EXISTS (
  SELECT 1 FROM users 
  WHERE id = auth.uid() 
  AND role = 'admin'
);

-- ============================================================================
-- ADMIN CONVERSATIONS VIEW - Add admin check
-- ============================================================================

DROP VIEW IF EXISTS public.admin_conversations;

CREATE VIEW public.admin_conversations
WITH (security_invoker = false) -- Keep SECURITY DEFINER behavior
AS
SELECT 
  c.id,
  c.title,
  c.type,
  c.status,
  c.booking_id,
  c.tour_id,
  c.created_at,
  c.last_message_at,
  CONCAT(COALESCE(creator.first_name, ''), ' ', COALESCE(creator.last_name, '')) AS created_by_name,
  creator.email AS created_by_email,
  creator.role AS created_by_role,
  (SELECT COUNT(*) FROM messages WHERE messages.conversation_id = c.id) AS message_count,
  (SELECT COUNT(*) FROM message_participants 
   WHERE message_participants.conversation_id = c.id 
   AND message_participants.is_active = true) AS participant_count,
  CASE
    WHEN c.booking_id IS NOT NULL THEN (
      SELECT tours.name 
      FROM bookings 
      JOIN tours ON bookings.tour_id = tours.id 
      WHERE bookings.id = c.booking_id
    )
    WHEN c.tour_id IS NOT NULL THEN (
      SELECT tours.name 
      FROM tours 
      WHERE tours.id = c.tour_id
    )
    ELSE NULL
  END AS related_tour_name
FROM conversations c
JOIN users creator ON c.created_by = creator.id
WHERE EXISTS (
  SELECT 1 FROM users 
  WHERE id = auth.uid() 
  AND role = 'admin'
)
ORDER BY c.last_message_at DESC;

-- ============================================================================
-- ADMIN STATUS VIEW - Add admin check
-- ============================================================================

DROP VIEW IF EXISTS public.admin_status;

CREATE VIEW public.admin_status
WITH (security_invoker = false) -- Keep SECURITY DEFINER behavior
AS
SELECT 
  CASE 
    WHEN EXISTS (SELECT 1 FROM users WHERE role = 'admin') 
    THEN 'Administrador configurado'
    ELSE 'Administrador pendiente de configuración'
  END AS status,
  COUNT(*) FILTER (WHERE users.role = 'admin') AS admin_count
FROM users
WHERE EXISTS (
  SELECT 1 FROM users 
  WHERE id = auth.uid() 
  AND role = 'admin'
);
