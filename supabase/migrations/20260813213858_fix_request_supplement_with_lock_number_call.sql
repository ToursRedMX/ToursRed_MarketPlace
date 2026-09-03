-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260813213858
--   name:    fix_request_supplement_with_lock_number_call
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
# Fix request_supplement_with_lock: remove invalid Number() call

## Problem
The function used `Number(v_supplement.price)` which is JavaScript syntax,
not valid PL/pgSQL. This causes a "function number(numeric) does not exist"
error on every call.

## Fix
Replace `Number(v_supplement.price) * p_quantity` with
`v_supplement.price * p_quantity` — v_supplement.price is already numeric.
*/

CREATE OR REPLACE FUNCTION public.request_supplement_with_lock(
  p_user_id uuid,
  p_booking_id uuid,
  p_tour_supplement_id uuid,
  p_quantity integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking record
;


  v_supplement record
;


  v_max_capacity integer
;


  v_used integer
;


  v_available integer
;


  v_existing_request record
;


  v_initial_status text
;


  v_platform_settings record
;


  v_service_charge_pct numeric := 5
;


  v_supplement_commission_pct numeric := 10
;


  v_subtotal numeric
;


  v_service_charge numeric
;


  v_supplement_commission numeric
;


  v_expires_at timestamptz
;


  v_new_record record
;


BEGIN
  -- Serialize concurrent requests for the same supplement
  PERFORM pg_advisory_xact_lock(hashtext(p_tour_supplement_id::text))
;



  -- Validate booking belongs to traveler
  SELECT id, user_id, tour_id, status
  INTO v_booking
  FROM bookings
  WHERE id = p_booking_id
    AND user_id = p_user_id
;



  IF v_booking IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Reserva no encontrada')
;


  END IF
;



  IF v_booking.status = 'cancelled' OR v_booking.status = 'cancellation_processing' THEN
    RETURN jsonb_build_object('success', false, 'error', 'No se pueden agregar suplementos a una reserva cancelada o en proceso de cancelacion')
;


  END IF
;



  -- Validate supplement belongs to the booking's tour and is active
  SELECT id, tour_id, name, price, requires_approval, is_active, max_capacity
  INTO v_supplement
  FROM tour_supplements
  WHERE id = p_tour_supplement_id
    AND tour_id = v_booking.tour_id
    AND is_active = true
;



  IF v_supplement IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Suplemento no encontrado o no disponible')
;


  END IF
;



  -- Check capacity
  IF v_supplement.max_capacity IS NOT NULL THEN
    SELECT COALESCE(SUM(bs.quantity), 0) INTO v_used
    FROM booking_supplements bs
    WHERE bs.tour_supplement_id = p_tour_supplement_id
      AND bs.status NOT IN ('rejected', 'cancelled')
;



    v_available := GREATEST(0, v_supplement.max_capacity - v_used)
;



    IF p_quantity > v_available THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Cupo insuficiente. Solo hay ' || v_available || ' lugar(es) disponible(s)'
      )
;


    END IF
;


  END IF
;



  -- Check for duplicate active request
  SELECT id, status
  INTO v_existing_request
  FROM booking_supplements
  WHERE booking_id = p_booking_id
    AND tour_supplement_id = p_tour_supplement_id
    AND status IN ('pending_approval', 'approved', 'pending_payment')
  LIMIT 1
;



  IF v_existing_request IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Ya existe una solicitud activa para este suplemento',
      'existing_id', v_existing_request.id,
      'existing_status', v_existing_request.status
    )
;


  END IF
;



  -- Determine initial status
  v_initial_status := CASE WHEN v_supplement.requires_approval THEN 'pending_approval' ELSE 'pending_payment' END
;



  -- Get platform settings
  SELECT service_charge_percentage, supplement_commission_percentage
  INTO v_platform_settings
  FROM platform_settings
  LIMIT 1
;



  v_service_charge_pct := COALESCE(v_platform_settings.service_charge_percentage, 5)
;


  v_supplement_commission_pct := COALESCE(v_platform_settings.supplement_commission_percentage, 10)
;



  v_subtotal := v_supplement.price * p_quantity
;


  v_service_charge := ROUND(v_subtotal * v_service_charge_pct / 100, 2)
;


  v_supplement_commission := ROUND(v_subtotal * v_supplement_commission_pct / 100, 2)
;



  -- For pending_payment (no approval required), set a 48-hour payment deadline
  IF v_initial_status = 'pending_payment' THEN
    v_expires_at := now() + INTERVAL '48 hours'
;


  ELSE
    v_expires_at := NULL
;


  END IF
;



  -- Create booking_supplement record
  INSERT INTO booking_supplements (
    booking_id,
    tour_supplement_id,
    quantity,
    unit_price,
    service_charge,
    supplement_commission,
    total_paid,
    status,
    requested_at,
    expires_at
  )
  VALUES (
    p_booking_id,
    p_tour_supplement_id,
    p_quantity,
    v_supplement.price,
    v_service_charge,
    v_supplement_commission,
    0,
    v_initial_status,
    now(),
    v_expires_at
  )
  RETURNING * INTO v_new_record
;



  RETURN jsonb_build_object(
    'success', true,
    'booking_supplement_id', v_new_record.id,
    'status', v_initial_status,
    'supplement_name', v_supplement.name,
    'requires_approval', v_supplement.requires_approval,
    'tour_id', v_booking.tour_id,
    'message', CASE
      WHEN v_supplement.requires_approval
      THEN 'Solicitud enviada. La agencia revisara y te notificara cuando sea aprobada.'
      ELSE 'Suplemento listo para pago. Procede a completar el pago.'
    END
  )
;


END
;


$$
;



GRANT EXECUTE ON FUNCTION public.request_supplement_with_lock TO authenticated
;



;
