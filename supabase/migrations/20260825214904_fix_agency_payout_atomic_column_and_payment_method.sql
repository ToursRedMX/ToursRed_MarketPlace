-- Repara el flujo de pagos a agencias, roto desde el 14-ago (migracion
-- 20260814050150_create_process_agency_payout_atomic_rpc.sql).
--
-- Sintoma: toda confirmacion de pago en /admin/payouts falla con
--   "column payout_date of relation agency_payouts does not exist"
-- y revierte. Por eso agency_payouts tiene 0 filas y nunca se ha emitido un
-- CFDI de comision: generate-commission-cfdi no se alcanza jamas.
--
-- Son DOS desalineados encadenados, no uno. Ambos verificados contra la BD
-- real con un INSERT dentro de un bloque DO revertido por excepcion forzada:
--
--   1. La funcion inserta en la columna `payout_date`, pero la columna de
--      agency_payouts se llama `payment_date`.
--
--   2. Corregido (1), el INSERT sigue fallando: el CHECK de payment_method
--      solo acepta spei_transfer/international_transfer/check/cash/other, y
--      AdminPayouts.tsx:920 manda bank_transfer (la opcion por defecto),
--      paypal o mercadopago. 3 de las 5 opciones de la UI son invalidas,
--      incluida la preseleccionada. Ningun archivo fuera de migrations_archive
--      usa spei_transfer ni international_transfer.
--
-- Ademas, la funcion aceptaba p_processed_by y p_bank_reference y los
-- descartaba, dejando en NULL columnas que si existen: un pago a agencia
-- quedaba sin rastro de quien lo autorizo.
--
-- Nota sobre permisos: la version del 14-ago terminaba con
--   GRANT EXECUTE ON FUNCTION process_agency_payout_atomic TO authenticated;
-- Ese grant ya fue revocado (ver
-- 20260610045222_revoke_authenticated_from_internal_security_definer_functions)
-- y NO se reintroduce aqui. CREATE OR REPLACE conserva la ACL existente.
--
-- Lo que si se corrige es el grant a PUBLIC que quedo vivo: la ACL era
--   {=X/postgres, postgres=X/postgres, service_role=X/postgres}
-- donde el grantee vacio es PUBLIC. Siendo SECURITY DEFINER, cualquier usuario
-- autenticado podia invocarla por /rest/v1/rpc/ y crear un payout marcando
-- comisiones como procesadas, saltandose el check de admin de
-- process-agency-payout. Misma familia que el hueco de autorizacion cerrado
-- hoy en las funciones de CFDI. Se revoca al final de esta migracion.

-- ---------------------------------------------------------------------------
-- 1. Alinear el vocabulario de payment_method con el que produce la UI.
--    Se conservan los valores previos para no invalidar filas historicas
--    (hoy la tabla tiene 0 filas, asi que no hay nada que migrar).
-- ---------------------------------------------------------------------------
ALTER TABLE public.agency_payouts
  DROP CONSTRAINT IF EXISTS agency_payouts_payment_method_check;

ALTER TABLE public.agency_payouts
  ADD CONSTRAINT agency_payouts_payment_method_check
  CHECK (payment_method = ANY (ARRAY[
    -- valores que emite AdminPayouts.tsx
    'bank_transfer'::text,
    'check'::text,
    'paypal'::text,
    'mercadopago'::text,
    'other'::text,
    -- vocabulario previo, conservado
    'spei_transfer'::text,
    'international_transfer'::text,
    'cash'::text
  ]));

-- ---------------------------------------------------------------------------
-- 2. Corregir la columna del INSERT y dejar de descartar processed_by y
--    bank_reference. Unicos cambios respecto a la version del 14-ago:
--      - payout_date -> payment_date
--      - + bank_reference, processed_by
--    El resto (montos, status, updates de commission_records y
--    cancellation_penalty_records, valor de retorno) queda identico.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION process_agency_payout_atomic(
  p_agency_id uuid,
  p_commission_ids uuid[],
  p_penalty_ids uuid[],
  p_total_amount numeric,
  p_net_amount numeric,
  p_platform_commission_amount numeric DEFAULT 0,
  p_payment_method text DEFAULT 'bank_transfer',
  p_notes text DEFAULT NULL,
  p_receipt_url text DEFAULT NULL,
  p_receipt_filename text DEFAULT NULL,
  p_bill_number text DEFAULT NULL,
  p_bank_reference text DEFAULT NULL,
  p_processed_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payout_id uuid;
  v_payout_code text;
  v_commission_count int;
  v_penalty_count int;
BEGIN
  v_payout_code := 'PAY-' || EXTRACT(EPOCH FROM now())::bigint;
  v_commission_count := array_length(p_commission_ids, 1);
  v_penalty_count := COALESCE(array_length(p_penalty_ids, 1), 0);

  -- Insert the payout record
  INSERT INTO agency_payouts (
    agency_id,
    amount,
    net_amount,
    platform_commission_amount,
    payment_method,
    notes,
    receipt_url,
    payout_code,
    bill_number,
    status,
    commission_records_count,
    payment_date,
    bank_reference,
    processed_by
  )
  VALUES (
    p_agency_id,
    p_total_amount,
    p_net_amount,
    p_platform_commission_amount,
    p_payment_method,
    p_notes,
    p_receipt_url,
    v_payout_code,
    p_bill_number,
    'completed',
    COALESCE(v_commission_count, 0) + v_penalty_count,
    CURRENT_DATE,
    p_bank_reference,
    p_processed_by
  )
  RETURNING id INTO v_payout_id;

  -- Update commission records atomically
  IF v_commission_count > 0 THEN
    UPDATE commission_records
    SET
      status = 'processed',
      payout_id = v_payout_id,
      processed_at = now(),
      payment_method = p_payment_method,
      payment_notes = p_notes,
      payment_receipt_url = p_receipt_url,
      payment_receipt_filename = p_receipt_filename,
      notified_at = now()
    WHERE id = ANY(p_commission_ids)
      AND agency_id = p_agency_id;
  END IF;

  -- Update penalty records atomically
  IF v_penalty_count > 0 THEN
    UPDATE cancellation_penalty_records
    SET
      status = 'processed',
      processed_at = now(),
      payment_method = p_payment_method,
      payment_notes = p_notes,
      payment_receipt_url = p_receipt_url,
      payment_receipt_filename = p_receipt_filename
    WHERE id = ANY(p_penalty_ids);
  END IF;

  RETURN jsonb_build_object(
    'payout_id', v_payout_id,
    'commission_count', COALESCE(v_commission_count, 0),
    'penalty_count', v_penalty_count
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Quitar el EXECUTE de PUBLIC sobre esta funcion SECURITY DEFINER.
--    process-agency-payout la invoca con el cliente de SERVICE ROLE
--    (process-agency-payout/index.ts:28), que conserva su propio grant
--    explicito (service_role=X/postgres), asi que el flujo no se afecta.
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION process_agency_payout_atomic(
  uuid, uuid[], uuid[], numeric, numeric, numeric,
  text, text, text, text, text, text, uuid
) FROM PUBLIC;
