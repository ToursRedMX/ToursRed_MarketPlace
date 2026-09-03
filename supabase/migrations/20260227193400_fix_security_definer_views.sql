-- Asegurar que las columnas necesarias existen en commission_records
ALTER TABLE public.commission_records ADD COLUMN IF NOT EXISTS reconciliation_notes text;
ALTER TABLE public.commission_records ADD COLUMN IF NOT EXISTS tour_completion_date date;
ALTER TABLE public.commission_records ADD COLUMN IF NOT EXISTS tour_end_date date;
ALTER TABLE public.commission_records ADD COLUMN IF NOT EXISTS payment_method text;
ALTER TABLE public.commission_records ADD COLUMN IF NOT EXISTS payment_receipt_url text;
ALTER TABLE public.commission_records ADD COLUMN IF NOT EXISTS payment_receipt_filename text;
ALTER TABLE public.commission_records ADD COLUMN IF NOT EXISTS payment_notes text;
ALTER TABLE public.commission_records ADD COLUMN IF NOT EXISTS notified_at timestamptz;

-- points_expiration_summary
CREATE OR REPLACE VIEW public.points_expiration_summary
WITH (security_invoker = true)
AS
SELECT
  date(t.expires_at) AS expiration_date,
  count(DISTINCT t.user_id) AS users_affected,
  sum(t.amount) AS total_points_expiring
FROM public.toursred_points_transactions t
WHERE t.type = 'earned'
  AND t.expires_at IS NOT NULL
  AND t.expires_at > now()
GROUP BY date(t.expires_at)
ORDER BY date(t.expires_at);

-- user_notifications
CREATE OR REPLACE VIEW public.user_notifications
WITH (security_invoker = true)
AS
SELECT
  n.id,
  n.user_id,
  n.type,
  n.title,
  n.message,
  n.data,
  n.is_read,
  n.created_at,
  n.updated_at,
  n.expires_at,
  CASE
    WHEN n.expires_at IS NOT NULL AND n.expires_at <= now() THEN true
    ELSE false
  END AS is_expired
FROM public.notifications n
WHERE n.user_id = (SELECT auth.uid())
  AND (n.expires_at IS NULL OR n.expires_at > now())
ORDER BY n.created_at DESC;

-- admin_conversations
CREATE OR REPLACE VIEW public.admin_conversations
WITH (security_invoker = true)
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
  concat(COALESCE(creator.first_name, ''), ' ', COALESCE(creator.last_name, '')) AS created_by_name,
  creator.email AS created_by_email,
  creator.role AS created_by_role,
  (SELECT count(*) FROM public.messages WHERE messages.conversation_id = c.id) AS message_count,
  (SELECT count(*) FROM public.message_participants WHERE message_participants.conversation_id = c.id AND message_participants.is_active = true) AS participant_count,
  CASE
    WHEN c.booking_id IS NOT NULL THEN (
      SELECT tours.name FROM public.bookings JOIN public.tours ON bookings.tour_id = tours.id WHERE bookings.id = c.booking_id
    )
    WHEN c.tour_id IS NOT NULL THEN (
      SELECT tours.name FROM public.tours WHERE tours.id = c.tour_id
    )
    ELSE NULL
  END AS related_tour_name
FROM public.conversations c
JOIN public.users creator ON c.created_by = creator.id
WHERE EXISTS (
  SELECT 1 FROM public.users WHERE users.id = (SELECT auth.uid()) AND users.role = 'admin'
)
ORDER BY c.last_message_at DESC;

-- admin_status
CREATE OR REPLACE VIEW public.admin_status
WITH (security_invoker = true)
AS
SELECT
  CASE
    WHEN EXISTS (SELECT 1 FROM public.users u WHERE u.role = 'admin') THEN 'Administrador configurado'
    ELSE 'Administrador pendiente de configuración'
  END AS status,
  count(*) FILTER (WHERE users.role = 'admin') AS admin_count
FROM public.users
WHERE EXISTS (
  SELECT 1 FROM public.users u WHERE u.id = (SELECT auth.uid()) AND u.role = 'admin'
);

-- admin_reviews_view
CREATE OR REPLACE VIEW public.admin_reviews_view
WITH (security_invoker = true)
AS
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
FROM public.reviews r
LEFT JOIN public.users u ON r.user_id = u.id
LEFT JOIN public.tours t ON r.tour_id = t.id
LEFT JOIN public.agencies a ON r.agency_id = a.id
WHERE EXISTS (
  SELECT 1 FROM public.users WHERE users.id = (SELECT auth.uid()) AND users.role = 'admin'
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
FROM public.agency_reviews ar
LEFT JOIN public.users u ON ar.traveler_id = u.id
LEFT JOIN public.bookings b ON ar.booking_id = b.id
LEFT JOIN public.tours t ON b.tour_id = t.id
LEFT JOIN public.agencies a ON ar.agency_id = a.id
WHERE EXISTS (
  SELECT 1 FROM public.users WHERE users.id = (SELECT auth.uid()) AND users.role = 'admin'
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
FROM public.traveler_reviews tr
LEFT JOIN public.users u ON tr.traveler_id = u.id
LEFT JOIN public.bookings b ON tr.booking_id = b.id
LEFT JOIN public.tours t ON b.tour_id = t.id
LEFT JOIN public.agencies a ON tr.agency_id = a.id
WHERE EXISTS (
  SELECT 1 FROM public.users WHERE users.id = (SELECT auth.uid()) AND users.role = 'admin'
);

-- commission_records_with_days_pending
CREATE OR REPLACE VIEW public.commission_records_with_days_pending
WITH (security_invoker = true)
AS
SELECT
  cr.id,
  cr.booking_id,
  cr.agency_id,
  cr.tour_id,
  cr.total_tour_price,
  cr.agency_commission_rate,
  cr.agency_commission_amount,
  cr.service_charge_rate,
  cr.service_charge_amount,
  cr.platform_total_revenue,
  cr.agency_net_amount,
  cr.status,
  cr.processed_at,
  cr.created_at,
  cr.payout_id,
  cr.payout_scheduled_date,
  cr.reconciliation_status,
  cr.reconciliation_notes,
  cr.tour_completion_date,
  CASE
    WHEN cr.tour_completion_date IS NOT NULL THEN (CURRENT_DATE - cr.tour_completion_date)
    ELSE NULL
  END AS days_since_completion,
  CASE
    WHEN cr.payout_id IS NOT NULL THEN false
    WHEN cr.tour_completion_date IS NULL THEN false
    WHEN cr.tour_completion_date > CURRENT_DATE THEN false
    ELSE true
  END AS is_ready_for_payout,
  a.name AS agency_name,
  t.name AS tour_name,
  t.start_date AS tour_start_date,
  t.end_date AS tour_end_date
FROM public.commission_records cr
JOIN public.agencies a ON cr.agency_id = a.id
JOIN public.tours t ON cr.tour_id = t.id;
