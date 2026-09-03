
CREATE OR REPLACE FUNCTION get_admin_bookings()
RETURNS TABLE (
  -- bookings fields
  id uuid,
  booking_code text,
  user_id uuid,
  tour_id uuid,
  agency_id uuid,
  booking_date date,
  created_at timestamptz,
  updated_at timestamptz,
  status text,
  payment_status text,
  payment_method text,
  total_price numeric,
  deposit_amount numeric,
  user_payment numeric,
  service_charge numeric,
  platform_revenue numeric,
  commission_amount numeric,
  travelers_count integer,
  count_adultos integer,
  count_ninos integer,
  count_infantes integer,
  count_adultos_mayores integer,
  count_mascotas integer,
  approval_status text,
  approval_notes text,
  approved_at timestamptz,
  is_no_show boolean,
  no_show_marked_at timestamptz,
  has_pending_reschedule boolean,
  has_pending_slot_reschedule boolean,
  slot_reschedule_response text,
  reschedule_response text,
  original_booking_date date,
  selected_date date,
  selected_time time,
  paid_at timestamptz,
  confirmation_email_sent boolean,
  payment_intent_id text,
  cancelled_at timestamptz,
  cancellation_type text,
  cancellation_refund_amount numeric,
  toursred_cash_used numeric,
  points_used integer,
  points_earned integer,
  used_membership_benefit boolean,
  service_charge_discount numeric,
  membership_service_fee_saved numeric,
  preventa_comision_descuento numeric,
  discount_amount numeric,
  es_reserva_preventa boolean,
  needs_seat_reselection boolean,
  selected_seats jsonb,
  -- users fields (aplanados)
  user_first_name text,
  user_last_name text,
  user_email text,
  user_profile_picture_url text,
  user_phone_number text,
  user_is_active boolean,
  user_curp text,
  user_rfc text,
  user_razon_social text,
  user_regimen_fiscal text,
  user_uso_cfdi text,
  user_is_foreign_traveler boolean,
  user_passport_number text,
  -- tours fields (aplanados)
  tour_name text,
  tour_destination text,
  tour_start_date date,
  tour_end_date date,
  tour_image_url text,
  tour_price numeric,
  tour_deposit_percentage numeric,
  tour_booking_approval_type text,
  tour_category text[],
  -- agencies fields (aplanados)
  agency_name text,
  agency_logo text,
  agency_contact_email text,
  agency_contact_phone text,
  agency_commission_rate numeric,
  -- commission_records fields (primer registro, aplanado)
  cr_id uuid,
  cr_agency_commission_rate numeric,
  cr_agency_commission_amount numeric,
  cr_service_charge_rate numeric,
  cr_service_charge_amount numeric,
  cr_platform_total_revenue numeric,
  cr_agency_net_amount numeric,
  cr_status text,
  cr_processed_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Validar que el llamador es admin o super_admin
  IF NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid()
      AND (role = 'admin' OR is_super_admin = true)
  ) THEN
    RAISE EXCEPTION 'Unauthorized: admin role required';
  END IF;

  RETURN QUERY
  SELECT
    -- bookings
    b.id,
    b.booking_code,
    b.user_id,
    b.tour_id,
    b.agency_id,
    b.booking_date,
    b.created_at,
    b.updated_at,
    b.status,
    b.payment_status,
    b.payment_method,
    b.total_price,
    b.deposit_amount,
    b.user_payment,
    b.service_charge,
    b.platform_revenue,
    b.commission_amount,
    b.travelers_count,
    b.count_adultos,
    b.count_ninos,
    b.count_infantes,
    b.count_adultos_mayores,
    b.count_mascotas,
    b.approval_status,
    b.approval_notes,
    b.approved_at,
    b.is_no_show,
    b.no_show_marked_at,
    b.has_pending_reschedule,
    b.has_pending_slot_reschedule,
    b.slot_reschedule_response,
    b.reschedule_response,
    b.original_booking_date,
    b.selected_date,
    b.selected_time,
    b.paid_at,
    b.confirmation_email_sent,
    b.payment_intent_id,
    b.cancelled_at,
    b.cancellation_type,
    b.cancellation_refund_amount,
    b.toursred_cash_used,
    b.points_used,
    b.points_earned,
    b.used_membership_benefit,
    b.service_charge_discount,
    b.membership_service_fee_saved,
    b.preventa_comision_descuento,
    b.discount_amount,
    b.es_reserva_preventa,
    b.needs_seat_reselection,
    b.selected_seats,
    -- users
    u.first_name,
    u.last_name,
    u.email,
    u.profile_picture_url,
    u.phone_number,
    u.is_active,
    u.curp,
    u.rfc,
    u.razon_social,
    u.regimen_fiscal,
    u.uso_cfdi,
    u.is_foreign_traveler,
    u.passport_number,
    -- tours
    t.name,
    t.destination,
    t.start_date,
    t.end_date,
    t.image_url,
    t.price,
    t.deposit_percentage,
    t.booking_approval_type,
    t.category,
    -- agencies
    a.name,
    a.logo,
    a.contact_email,
    a.contact_phone,
    a.commission_rate,
    -- commission_records (primer registro por booking)
    cr.id,
    cr.agency_commission_rate,
    cr.agency_commission_amount,
    cr.service_charge_rate,
    cr.service_charge_amount,
    cr.platform_total_revenue,
    cr.agency_net_amount,
    cr.status,
    cr.processed_at
  FROM bookings b
  LEFT JOIN users u ON u.id = b.user_id
  LEFT JOIN tours t ON t.id = b.tour_id
  LEFT JOIN agencies a ON a.id = b.agency_id
  LEFT JOIN LATERAL (
    SELECT cr2.*
    FROM commission_records cr2
    WHERE cr2.booking_id = b.id
    ORDER BY cr2.created_at DESC
    LIMIT 1
  ) cr ON true
  ORDER BY b.created_at DESC;
END;
$$;

-- Solo usuarios autenticados pueden llamar esta funcion
-- La validacion interna asegura que solo admins accedan a los datos
REVOKE ALL ON FUNCTION get_admin_bookings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_admin_bookings() TO authenticated;
