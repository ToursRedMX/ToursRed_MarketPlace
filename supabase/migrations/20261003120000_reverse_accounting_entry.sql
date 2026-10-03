-- ============================================================================
-- RPC de reverso de poliza (pendiente 12 de la entrada 33)
-- ============================================================================
--
-- No existia una forma de reversar una poliza publicada: las tres primeras
-- reversas del ERP (D-2026-10-0002 a 0004, 02-oct-2026) se hicieron llamando
-- a `create_accounting_entry_atomic` a mano, con las partidas invertidas
-- escritas una por una. Funciona, pero cada reversa futura repetiria el mismo
-- trabajo manual y el mismo riesgo de invertir una partida mal.
--
-- `reverse_accounting_entry(p_entry_id, p_reason)` automatiza exactamente ese
-- patron: lee las partidas de la poliza original, invierte cargo/abono de
-- cada una, y llama a `create_accounting_entry_atomic` (ya endurecida: exige
-- partidas balanceadas, asigna folio, y es idempotente por source_type +
-- source_id) con `entry_type = 'diario'` y `source_type = 'reversal'`.
--
-- NO se reusa `source_type = 'manual'` para esto: esa etiqueta ya la usa
-- `asentar_comisiones_faltantes()` (entrada 11) con `source_id` = el asiento
-- original tambien -- si una reversa usara el mismo par (manual, <id>) que un
-- asiento de comision tardia sobre ESE MISMO id, la deduplicacion de
-- `create_accounting_entry_atomic` (unica por source_type+source_id) los
-- confundiria. `reversal` es su propia etiqueta, y de paso deja la reversa
-- identificable en el libro (hoy aparecen como `manual`, sin distinguirse de
-- cualquier otro asiento escrito a mano).
--
-- Permiso: admin o contador -- el mismo techo que ya tiene toda la pantalla
-- /accounting (ProtectedRoute, y los botones de Confirmar/Eliminar de ahi se
-- gatean igual). Nada de un permiso granular nuevo que la pantalla no usa en
-- ningun otro boton suyo. Eso obliga a tocar tambien el permiso INTERNO de
-- `create_accounting_entry_atomic` (mas abajo): solo dejaba pasar a
-- admin/super_admin, y un contador autorizado aqui habria chocado ahi.

-- `create_accounting_entry_atomic` solo dejaba pasar a admin/super_admin
-- (`is_admin_user()`) cuando hay sesion. Un contador que llame a
-- `reverse_accounting_entry` de mas abajo pasaria el permiso de ESA funcion
-- y despues chocaria con "Acceso no autorizado" aqui dentro -- la funcion de
-- mas abajo nunca podria usarla un contador, aunque se la autorice. Se
-- amplia al mismo par (admin, accountant) que ya tienen las tres politicas
-- RLS de `accounting_entries` (INSERT/UPDATE/SELECT): un contador YA puede
-- escribir esta tabla a mano por ahi, asi que esto no abre permiso nuevo,
-- solo deja de bloquear el camino seguro (este RPC) para quien ya tiene el
-- inseguro (INSERT/UPDATE directo).
CREATE OR REPLACE FUNCTION public.create_accounting_entry_atomic(
  p_entry_type text,
  p_description text,
  p_source_type text,
  p_source_id uuid,
  p_entry_date date,
  p_lines jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing uuid;
  v_entry uuid;
  v_year integer := EXTRACT(YEAR FROM p_entry_date)::integer;
  v_month integer := EXTRACT(MONTH FROM p_entry_date)::integer;
  v_debit numeric;
  v_credit numeric;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.current_user_has_role(ARRAY['admin', 'accountant']) THEN
    RAISE EXCEPTION 'Acceso no autorizado';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    format('accounting-source:%s:%s', p_source_type, p_source_id), 0
  ));
  SELECT id INTO v_existing FROM accounting_entries
  WHERE source_type = p_source_type AND source_id = p_source_id
  LIMIT 1;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

  SELECT COALESCE(SUM((x->>'debit')::numeric), 0),
         COALESCE(SUM((x->>'credit')::numeric), 0)
  INTO v_debit, v_credit
  FROM jsonb_array_elements(p_lines) x;
  IF jsonb_array_length(p_lines) < 2 OR v_debit <= 0 OR v_debit <> v_credit THEN
    RAISE EXCEPTION 'El asiento debe tener al menos dos partidas y estar balanceado';
  END IF;

  v_entry := gen_random_uuid();
  INSERT INTO accounting_entries (
    id, entry_number, entry_type, entry_date, period_year, period_month,
    description, source_type, source_id, is_posted, posted_at
  ) VALUES (
    v_entry, generate_entry_number(p_entry_type, v_year, v_month),
    p_entry_type, p_entry_date, v_year, v_month, p_description,
    p_source_type, p_source_id, false, NULL
  );

  INSERT INTO accounting_entry_lines (
    entry_id, line_number, account_code, description, debit, credit
  )
  SELECT v_entry, row_number() OVER (), x->>'account_code',
         COALESCE(x->>'description', p_description),
         COALESCE((x->>'debit')::numeric, 0),
         COALESCE((x->>'credit')::numeric, 0)
  FROM jsonb_array_elements(p_lines) x;

  UPDATE accounting_entries
  SET is_posted = true, posted_at = now(), updated_at = now()
  WHERE id = v_entry;
  RETURN v_entry;
END;
$$;

ALTER TABLE public.accounting_entries
  DROP CONSTRAINT IF EXISTS accounting_entries_source_type_check;
ALTER TABLE public.accounting_entries
  ADD CONSTRAINT accounting_entries_source_type_check
  CHECK (source_type IN (
    'booking', 'payout', 'cancellation', 'manual', 'membership', 'gift_card',
    'gift_card_sale', 'gift_card_redemption', 'gift_card_expiration',
    'featured_slot', 'apertura', 'insurance_settlement', 'insurance_commission',
    'wallet_topup', 'executive_commission', 'insurance', 'supplement',
    'optional_service', 'payment_plan_installment', 'dispute', 'payment_refund',
    'gasto_operacion', 'reversal'
  ));

CREATE OR REPLACE FUNCTION public.reverse_accounting_entry(
  p_entry_id uuid,
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_original accounting_entries;
  v_lines jsonb;
  v_reversa uuid;
BEGIN
  -- Mismo escape que create_accounting_entry_atomic: un llamador sin sesion
  -- (service_role, cron) pasa libre; un usuario con sesion necesita el rol.
  IF auth.uid() IS NOT NULL AND NOT public.current_user_has_role(ARRAY['admin', 'accountant']) THEN
    RAISE EXCEPTION 'No tienes permiso para reversar polizas.'
      USING ERRCODE = '42501';
  END IF;

  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'Hay que indicar el motivo de la reversa.';
  END IF;

  SELECT * INTO v_original FROM public.accounting_entries WHERE id = p_entry_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La poliza no existe.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT v_original.is_posted THEN
    RAISE EXCEPTION 'Solo se puede reversar una poliza publicada; un borrador se edita o se elimina directamente.';
  END IF;

  -- Cargo <-> abono invertidos, la cuenta y la descripcion se conservan.
  SELECT jsonb_agg(jsonb_build_object(
    'account_code', l.account_code,
    'description', 'Reversa: ' || l.description,
    'debit', l.credit,
    'credit', l.debit
  ) ORDER BY l.line_number)
  INTO v_lines
  FROM public.accounting_entry_lines l
  WHERE l.entry_id = p_entry_id;

  v_reversa := public.create_accounting_entry_atomic(
    'diario',
    'Reversa de ' || v_original.entry_number || ': ' || p_reason,
    'reversal',
    p_entry_id,
    CURRENT_DATE,
    v_lines
  );
  RETURN v_reversa;
END;
$$;

COMMENT ON FUNCTION public.reverse_accounting_entry(uuid, text) IS
  'Reversa una poliza publicada: invierte cargo/abono de cada partida y publica el resultado via create_accounting_entry_atomic (source_type=reversal, source_id=la poliza original -- idempotente, una segunda llamada devuelve la misma reversa en vez de duplicarla).';

REVOKE ALL ON FUNCTION public.reverse_accounting_entry(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_accounting_entry(uuid, text) TO authenticated, service_role;
