-- =============================================
-- 1. CUENTAS NUEVAS
-- =============================================

-- Cuenta padre 218 si no existe (Pasivos Circulantes de corto plazo)
INSERT INTO chart_of_accounts (code, sat_group_code, name, account_type, parent_code, level, nature, is_system, description)
VALUES ('218', '218', 'Otros Pasivos Circulantes', 'pasivo', '20', 2, 'acreedora', true, 'Grupo de pasivos circulantes diversos')
ON CONFLICT (code) DO NOTHING;

-- 218-11 ToursRed Cash / Monedero de Clientes (si no existe)
INSERT INTO chart_of_accounts (code, sat_group_code, name, account_type, parent_code, level, nature, is_system, description)
VALUES (
  '218-11', '218-01',
  'ToursRed Cash — Monedero de Clientes',
  'pasivo', '218', 3, 'acreedora', true,
  'Saldo del monedero ToursRed Cash que la plataforma debe a los viajeros'
)
ON CONFLICT (code) DO NOTHING;

-- 218-12 Tarjetas de Regalo Pendientes de Canje
INSERT INTO chart_of_accounts (code, sat_group_code, name, account_type, parent_code, level, nature, is_system, description)
VALUES (
  '218-12', '218-02',
  'Tarjetas de Regalo Pendientes de Canje',
  'pasivo', '218', 3, 'acreedora', true,
  'Pasivo por tarjetas de regalo vendidas y aun no canjeadas. Se libera al canje (traslado a 218-11) o al vencimiento (ingreso 4090)'
)
ON CONFLICT (code) DO NOTHING;

-- 4090 Ingreso por Vencimiento de Tarjetas de Regalo
INSERT INTO chart_of_accounts (code, sat_group_code, name, account_type, parent_code, level, nature, is_system, description)
VALUES (
  '4090', '4090',
  'Ingreso por Vencimiento de Tarjetas de Regalo',
  'ingreso', '40', 3, 'acreedora', true,
  'Ingreso reconocido cuando una tarjeta de regalo vence sin ser canjeada. Se transfiere del pasivo 218-12.'
)
ON CONFLICT (code) DO NOTHING;

-- =============================================
-- 2. AMPLIAR CONSTRAINT source_type (si no incluye gift_card_sale / gift_card_redemption)
--    El constraint actual ya permite 'gift_card' — agregamos los subtipos nuevos
-- =============================================
ALTER TABLE accounting_entries
  DROP CONSTRAINT IF EXISTS accounting_entries_source_type_check;

ALTER TABLE accounting_entries
  ADD CONSTRAINT accounting_entries_source_type_check
    CHECK (source_type IN (
      'booking', 'payout', 'cancellation', 'manual', 'membership',
      'gift_card', 'gift_card_sale', 'gift_card_redemption', 'gift_card_expiration',
      'featured_slot'
    ));

-- =============================================
-- 3. FUNCION: POLIZA DE VENTA DE GIFT CARD
-- =============================================
CREATE OR REPLACE FUNCTION create_accounting_entry_for_gift_card_sale(p_gift_card_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_gc         record;
  v_entry_id   uuid;
  v_entry_num  text;
  v_year       integer;
  v_month      integer;
BEGIN
  -- Idempotencia
  IF EXISTS (
    SELECT 1 FROM accounting_entries
    WHERE source_type = 'gift_card_sale' AND source_id = p_gift_card_id
  ) THEN
    RETURN NULL;
  END IF;

  SELECT id, code, amount, purchased_at, payment_status
  INTO v_gc
  FROM gift_cards
  WHERE id = p_gift_card_id
    AND payment_status = 'paid';

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_year  := EXTRACT(YEAR  FROM COALESCE(v_gc.purchased_at, NOW()))::integer;
  v_month := EXTRACT(MONTH FROM COALESCE(v_gc.purchased_at, NOW()))::integer;

  v_entry_num := generate_entry_number('ingreso', v_year, v_month);

  INSERT INTO accounting_entries (
    entry_number, entry_type, entry_date, period_year, period_month,
    description, source_type, source_id, is_posted
  ) VALUES (
    v_entry_num,
    'ingreso',
    COALESCE(v_gc.purchased_at::date, CURRENT_DATE),
    v_year,
    v_month,
    'Venta de Tarjeta de Regalo ' || v_gc.code,
    'gift_card_sale',
    p_gift_card_id,
    true
  )
  RETURNING id INTO v_entry_id;

  -- Debe: Bancos (entra el efectivo)
  INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit)
  VALUES (v_entry_id, 1, '102', 'Cobro tarjeta de regalo ' || v_gc.code, v_gc.amount, 0);

  -- Haber: 218-12 Tarjetas de Regalo Pendientes (pasivo — no es ingreso todavia)
  INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit)
  VALUES (v_entry_id, 2, '218-12', 'Pasivo gift card pendiente de canje ' || v_gc.code, 0, v_gc.amount);

  RETURN v_entry_id;
END;
$$;

-- =============================================
-- 4. FUNCION: POLIZA DE CANJE DE GIFT CARD
-- =============================================
CREATE OR REPLACE FUNCTION create_accounting_entry_for_gift_card_redemption(p_gift_card_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_gc        record;
  v_entry_id  uuid;
  v_entry_num text;
  v_year      integer;
  v_month     integer;
BEGIN
  -- Idempotencia
  IF EXISTS (
    SELECT 1 FROM accounting_entries
    WHERE source_type = 'gift_card_redemption' AND source_id = p_gift_card_id
  ) THEN
    RETURN NULL;
  END IF;

  SELECT id, code, amount, redeemed_at
  INTO v_gc
  FROM gift_cards
  WHERE id = p_gift_card_id
    AND status = 'redeemed';

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_year  := EXTRACT(YEAR  FROM COALESCE(v_gc.redeemed_at, NOW()))::integer;
  v_month := EXTRACT(MONTH FROM COALESCE(v_gc.redeemed_at, NOW()))::integer;

  v_entry_num := generate_entry_number('diario', v_year, v_month);

  INSERT INTO accounting_entries (
    entry_number, entry_type, entry_date, period_year, period_month,
    description, source_type, source_id, is_posted
  ) VALUES (
    v_entry_num,
    'diario',
    COALESCE(v_gc.redeemed_at::date, CURRENT_DATE),
    v_year,
    v_month,
    'Canje de Tarjeta de Regalo ' || v_gc.code,
    'gift_card_redemption',
    p_gift_card_id,
    true
  )
  RETURNING id INTO v_entry_id;

  -- Debe: 218-12 baja el pasivo gift card
  INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit)
  VALUES (v_entry_id, 1, '218-12', 'Canje gift card ' || v_gc.code, v_gc.amount, 0);

  -- Haber: 218-11 sube el pasivo ToursRed Cash (el saldo pasa al monedero del cliente)
  INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit)
  VALUES (v_entry_id, 2, '218-11', 'Canje a monedero ToursRed Cash ' || v_gc.code, 0, v_gc.amount);

  RETURN v_entry_id;
END;
$$;

-- =============================================
-- 5. FUNCION: PROCESAR VENCIMIENTOS DE GIFT CARDS
--    Llamada por cron diario
-- =============================================
CREATE OR REPLACE FUNCTION process_expired_gift_cards_accounting()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_gc         record;
  v_entry_id   uuid;
  v_entry_num  text;
  v_year       integer;
  v_month      integer;
  v_processed  integer := 0;
BEGIN
  FOR v_gc IN
    SELECT id, code, amount, expires_at
    FROM gift_cards
    WHERE expires_at < NOW()
      AND status NOT IN ('redeemed', 'expired', 'cancelled')
      AND payment_status = 'paid'
      AND NOT EXISTS (
        SELECT 1 FROM accounting_entries
        WHERE source_type = 'gift_card_expiration' AND source_id = gift_cards.id
      )
  LOOP
    -- Marcar como expirada
    UPDATE gift_cards SET status = 'expired', updated_at = NOW()
    WHERE id = v_gc.id;

    v_year  := EXTRACT(YEAR  FROM v_gc.expires_at)::integer;
    v_month := EXTRACT(MONTH FROM v_gc.expires_at)::integer;

    v_entry_num := generate_entry_number('ingreso', v_year, v_month);

    INSERT INTO accounting_entries (
      entry_number, entry_type, entry_date, period_year, period_month,
      description, source_type, source_id, is_posted
    ) VALUES (
      v_entry_num,
      'ingreso',
      v_gc.expires_at::date,
      v_year,
      v_month,
      'Vencimiento Tarjeta de Regalo ' || v_gc.code,
      'gift_card_expiration',
      v_gc.id,
      true
    )
    RETURNING id INTO v_entry_id;

    -- Debe: 218-12 baja el pasivo (ya no hay obligacion)
    INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit)
    VALUES (v_entry_id, 1, '218-12', 'Vencimiento gift card ' || v_gc.code, v_gc.amount, 0);

    -- Haber: 4090 se reconoce el ingreso
    INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit)
    VALUES (v_entry_id, 2, '4090', 'Ingreso por vencimiento gift card ' || v_gc.code, 0, v_gc.amount);

    v_processed := v_processed + 1;
  END LOOP;

  RETURN jsonb_build_object('expired_processed', v_processed);
END;
$$;

-- =============================================
-- 6. CRON DIARIO — PROCESAR VENCIMIENTOS
-- =============================================
SELECT cron.unschedule('process-expired-gift-cards-accounting')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'process-expired-gift-cards-accounting'
);

SELECT cron.schedule(
  'process-expired-gift-cards-accounting',
  '0 3 * * *',
  $$SELECT process_expired_gift_cards_accounting();$$
);

-- =============================================
-- 7. FUNCION RPC: RESUMEN CONTABLE DE GIFT CARDS
-- =============================================
CREATE OR REPLACE FUNCTION get_gift_card_accounting_summary()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pending_balance    numeric := 0;
  v_sold_count         integer := 0;
  v_redeemed_count     integer := 0;
  v_expired_count      integer := 0;
  v_expiration_income  numeric := 0;
BEGIN
  -- Saldo pendiente = suma de creditos en 218-12 menos debitos en 218-12
  SELECT COALESCE(SUM(l.credit - l.debit), 0)
  INTO v_pending_balance
  FROM accounting_entry_lines l
  WHERE l.account_code = '218-12';

  -- Gift cards vendidas (polizas de venta)
  SELECT COUNT(*)
  INTO v_sold_count
  FROM accounting_entries
  WHERE source_type = 'gift_card_sale';

  -- Gift cards canjeadas (polizas de canje)
  SELECT COUNT(*)
  INTO v_redeemed_count
  FROM accounting_entries
  WHERE source_type = 'gift_card_redemption';

  -- Gift cards vencidas
  SELECT COUNT(*)
  INTO v_expired_count
  FROM gift_cards
  WHERE status = 'expired';

  -- Ingresos reconocidos por vencimiento (creditos en cuenta 4090 de polizas de vencimiento)
  SELECT COALESCE(SUM(l.credit), 0)
  INTO v_expiration_income
  FROM accounting_entry_lines l
  JOIN accounting_entries ae ON ae.id = l.entry_id
  WHERE l.account_code = '4090'
    AND ae.source_type = 'gift_card_expiration';

  RETURN jsonb_build_object(
    'pending_balance',   v_pending_balance,
    'sold_count',        v_sold_count,
    'redeemed_count',    v_redeemed_count,
    'expired_count',     v_expired_count,
    'expiration_income', v_expiration_income
  );
END;
$$;

-- Permitir que admins y accountants llamen la funcion
REVOKE ALL ON FUNCTION get_gift_card_accounting_summary() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_gift_card_accounting_summary() TO authenticated;

REVOKE ALL ON FUNCTION create_accounting_entry_for_gift_card_sale(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_accounting_entry_for_gift_card_sale(uuid) TO service_role;

REVOKE ALL ON FUNCTION create_accounting_entry_for_gift_card_redemption(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_accounting_entry_for_gift_card_redemption(uuid) TO service_role;

REVOKE ALL ON FUNCTION process_expired_gift_cards_accounting() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION process_expired_gift_cards_accounting() TO service_role;
