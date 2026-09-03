-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260217020911
--   name:    create_financial_calculation_functions_and_triggers
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
  # Create Financial Calculation Functions and Triggers

  1. Functions
    - `calculate_transaction_breakdown()` - Calculates financial split for any transaction type
    - `record_booking_financial_transaction()` - Records transaction when booking is confirmed
    - `record_cancellation_financial_transaction()` - Records transaction for cancellations
    - `update_payout_totals()` - Updates agency_payouts totals when commission_records are linked

  2. Triggers
    - Trigger on bookings table for status changes to 'confirmed' and payment_status = 'succeeded'
    - Trigger on booking_cancellations table for new cancellations
    - Trigger on commission_records for payout_id changes

  3. Notes
    - Automatically maintains financial_transactions ledger
    - Ensures all money movements are tracked
    - Supports all cancellation policies (100%, 50%, no_refund, no_show)
*/

-- Function to calculate transaction breakdown based on type and amounts
CREATE OR REPLACE FUNCTION calculate_transaction_breakdown(
  p_transaction_type text,
  p_total_price numeric,
  p_commission_rate numeric,
  p_service_charge_rate numeric,
  p_cancellation_policy text DEFAULT NULL
)
RETURNS TABLE (
  gross_amount numeric,
  platform_commission numeric,
  net_to_agency numeric,
  platform_revenue numeric
) AS $$
DECLARE
  v_agency_commission numeric
;


  v_service_charge numeric
;


  v_refund_percentage numeric DEFAULT 0
;


  v_amount_after_refund numeric
;


BEGIN
  -- Calculate base commissions
  v_agency_commission := p_total_price * p_commission_rate
;


  v_service_charge := p_total_price * p_service_charge_rate
;


  
  -- Handle different transaction types
  CASE p_transaction_type
    -- Regular confirmed booking
    WHEN 'booking' THEN
      gross_amount := p_total_price
;


      platform_commission := v_agency_commission + v_service_charge
;


      net_to_agency := p_total_price - platform_commission
;


      platform_revenue := platform_commission
;


    
    -- Full refund cancellation (100% refund to traveler)
    WHEN 'cancellation_full' THEN
      gross_amount := p_total_price
;


      platform_commission := CASE 
        WHEN p_cancellation_policy = 'pending_approval' THEN v_agency_commission + v_service_charge
        ELSE v_service_charge 
      END
;


      net_to_agency := 0
;


      platform_revenue := platform_commission
;


    
    -- Partial refund cancellation (50% refund, 50% retained)
    WHEN 'cancellation_partial' THEN
      v_refund_percentage := 0.50
;


      v_amount_after_refund := p_total_price * (1 - v_refund_percentage)
;


      gross_amount := v_amount_after_refund
;


      v_agency_commission := v_amount_after_refund * p_commission_rate
;


      v_service_charge := v_amount_after_refund * p_service_charge_rate
;


      platform_commission := v_agency_commission + v_service_charge
;


      net_to_agency := v_amount_after_refund - platform_commission
;


      platform_revenue := platform_commission
;


    
    -- No show (100% to agency after commission)
    WHEN 'no_show' THEN
      gross_amount := p_total_price
;


      platform_commission := v_agency_commission + v_service_charge
;


      net_to_agency := p_total_price - platform_commission
;


      platform_revenue := platform_commission
;


    
    -- Tour cancelled by agency (full refund, agency may absorb costs)
    WHEN 'tour_cancellation_by_agency' THEN
      gross_amount := p_total_price
;


      platform_commission := 0
;


      net_to_agency := 0
;


      platform_revenue := 0
;


    
    -- Manual adjustment
    WHEN 'adjustment' THEN
      gross_amount := p_total_price
;


      platform_commission := v_agency_commission + v_service_charge
;


      net_to_agency := p_total_price - platform_commission
;


      platform_revenue := platform_commission
;


    
    ELSE
      RAISE EXCEPTION 'Unknown transaction type: %', p_transaction_type
;


  END CASE
;


  
  RETURN NEXT
;


END
;


$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
;



-- Function to record financial transaction when booking is confirmed
CREATE OR REPLACE FUNCTION record_booking_financial_transaction()
RETURNS TRIGGER AS $$
DECLARE
  v_breakdown record
;


  v_agency_id uuid
;


  v_tour_id uuid
;


BEGIN
  -- Only process when booking moves to confirmed with successful payment
  IF NEW.status = 'confirmed' AND NEW.payment_status = 'succeeded' 
     AND (OLD.status != 'confirmed' OR OLD.payment_status != 'succeeded') THEN
    
    -- Get agency_id and tour_id
    SELECT agency_id, tour_id INTO v_agency_id, v_tour_id
    FROM bookings
    WHERE id = NEW.id
;


    
    -- Calculate breakdown
    SELECT * INTO v_breakdown
    FROM calculate_transaction_breakdown(
      'booking',
      NEW.total_price,
      COALESCE(NEW.commission_amount / NULLIF(NEW.total_price, 0), 0.10),
      COALESCE(NEW.service_charge / NULLIF(NEW.total_price, 0), 0.03),
      NULL
    )
;


    
    -- Insert financial transaction
    INSERT INTO financial_transactions (
      transaction_date,
      transaction_type,
      agency_id,
      booking_id,
      tour_id,
      gross_amount,
      platform_commission,
      net_to_agency,
      platform_revenue,
      description,
      payment_status,
      reconciliation_status
    ) VALUES (
      NEW.paid_at,
      'booking',
      v_agency_id,
      NEW.id,
      v_tour_id,
      v_breakdown.gross_amount,
      v_breakdown.platform_commission,
      v_breakdown.net_to_agency,
      v_breakdown.platform_revenue,
      'Booking confirmed - ' || NEW.booking_code,
      'pending',
      'pending'
    )
;


  END IF
;


  
  RETURN NEW
;


END
;


$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
;



-- Function to record financial transaction for cancellations
CREATE OR REPLACE FUNCTION record_cancellation_financial_transaction()
RETURNS TRIGGER AS $$
DECLARE
  v_breakdown record
;


  v_booking record
;


  v_transaction_type text
;


BEGIN
  -- Get booking details
  SELECT b.*, b.agency_id, b.tour_id INTO v_booking
  FROM bookings b
  WHERE b.id = NEW.booking_id
;


  
  -- Determine transaction type based on cancellation policy
  CASE NEW.cancellation_policy_type
    WHEN '100_percent' THEN
      v_transaction_type := 'cancellation_full'
;


    WHEN '50_percent' THEN
      v_transaction_type := 'cancellation_partial'
;


    WHEN 'no_refund' THEN
      v_transaction_type := 'no_show'
;


    WHEN 'no_show' THEN
      v_transaction_type := 'no_show'
;


    WHEN 'pending_approval' THEN
      v_transaction_type := 'cancellation_full'
;


    ELSE
      v_transaction_type := 'cancellation_full'
;


  END CASE
;


  
  -- Calculate breakdown
  SELECT * INTO v_breakdown
  FROM calculate_transaction_breakdown(
    v_transaction_type,
    NEW.original_deposit_amount,
    COALESCE(v_booking.commission_amount / NULLIF(v_booking.total_price, 0), 0.10),
    COALESCE(v_booking.service_charge / NULLIF(v_booking.total_price, 0), 0.03),
    NEW.cancellation_policy_type
  )
;


  
  -- Insert financial transaction
  INSERT INTO financial_transactions (
    transaction_date,
    transaction_type,
    agency_id,
    booking_id,
    tour_id,
    cancellation_id,
    gross_amount,
    platform_commission,
    net_to_agency,
    platform_revenue,
    description,
    payment_status,
    reconciliation_status,
    metadata
  ) VALUES (
    NEW.cancelled_at,
    v_transaction_type,
    v_booking.agency_id,
    NEW.booking_id,
    v_booking.tour_id,
    NEW.id,
    v_breakdown.gross_amount,
    v_breakdown.platform_commission,
    v_breakdown.net_to_agency,
    v_breakdown.platform_revenue,
    'Cancellation - ' || NEW.cancellation_policy_type || ' policy',
    CASE WHEN v_breakdown.net_to_agency > 0 THEN 'pending' ELSE 'cancelled' END,
    'pending',
    jsonb_build_object(
      'cancellation_policy', NEW.cancellation_policy_type,
      'days_before_tour', NEW.days_before_tour,
      'refund_to_traveler', NEW.refund_amount_to_traveler
    )
  )
;


  
  RETURN NEW
;


END
;


$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
;



-- Function to update payout totals when commission records are linked to a payout
CREATE OR REPLACE FUNCTION update_payout_totals()
RETURNS TRIGGER AS $$
DECLARE
  v_total_amount numeric
;


  v_count integer
;


BEGIN
  -- Only process when payout_id is being set (not when it's being removed)
  IF NEW.payout_id IS NOT NULL AND (OLD.payout_id IS NULL OR OLD.payout_id != NEW.payout_id) THEN
    -- Calculate totals for this payout
    SELECT 
      COALESCE(SUM(agency_net_amount), 0),
      COUNT(*)
    INTO v_total_amount, v_count
    FROM commission_records
    WHERE payout_id = NEW.payout_id
;


    
    -- Update the payout record
    UPDATE agency_payouts
    SET 
      amount = v_total_amount,
      commission_records_count = v_count,
      updated_at = now()
    WHERE id = NEW.payout_id
;


    
    -- Update financial transaction payment status
    UPDATE financial_transactions
    SET 
      payment_status = 'paid',
      payout_id = NEW.payout_id,
      reconciliation_status = 'reconciled'
    WHERE booking_id IN (
      SELECT booking_id 
      FROM commission_records 
      WHERE id = NEW.id
    )
;


  END IF
;


  
  RETURN NEW
;


END
;


$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
;



-- Drop existing triggers if they exist
DROP TRIGGER IF EXISTS record_booking_financial_transaction_trigger ON bookings
;


DROP TRIGGER IF EXISTS record_cancellation_financial_transaction_trigger ON booking_cancellations
;


DROP TRIGGER IF EXISTS update_payout_totals_trigger ON commission_records
;



-- Create triggers
CREATE TRIGGER record_booking_financial_transaction_trigger
  AFTER INSERT OR UPDATE ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION record_booking_financial_transaction()
;



CREATE TRIGGER record_cancellation_financial_transaction_trigger
  AFTER INSERT ON booking_cancellations
  FOR EACH ROW
  EXECUTE FUNCTION record_cancellation_financial_transaction()
;



CREATE TRIGGER update_payout_totals_trigger
  AFTER UPDATE ON commission_records
  FOR EACH ROW
  WHEN (NEW.payout_id IS DISTINCT FROM OLD.payout_id)
  EXECUTE FUNCTION update_payout_totals()
;
