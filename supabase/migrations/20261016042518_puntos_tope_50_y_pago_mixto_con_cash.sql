-- Puntos con tope del 50% en suplementos, extras y mensualidades, pagados junto
-- con ToursRed Cash; y los puntos como descuento absorbido por ToursRed en la
-- contabilidad.
--
-- ============================================================================
-- LA REGLA (Axel, 16-oct-2026)
-- ============================================================================
--
-- Los puntos cubren como maximo el 50% de CUALQUIER pago, no solo de la
-- reserva (create_booking_atomic ya lo aplicaba ahi). En una mensualidad el
-- tope se mide sobre cada abono. El descuento por puntos lo absorbe ToursRed:
-- la agencia cobra completo.
--
-- Hasta hoy, suplementos, extras (servicio opcional y seguro) y mensualidades
-- se pagaban con UNA forma de pago, y una de ellas era "points" al 100%. Las
-- Edge Functions dejan de aceptar "points" sola: los puntos van en
-- `points_to_use` junto con ToursRed Cash (puntos + pasarela es el PR que
-- sigue). Esta migracion pone lo que esas funciones necesitan de la base.
--
-- ============================================================================
-- LO QUE SE ENCONTRO AL MEDIR (16-oct-2026)
-- ============================================================================
--
-- 1. Ningun asiento contable conocia los puntos. create_accounting_entry_for_
--    booking cargaba a 102 Bancos lo pagado con puntos como si hubiera entrado
--    dinero:
--
--      TRG-0E05WC6UZ7P  $250 Stripe + 25,000 pts   102 = 484.63 (entraron 234.63)
--      TRG-IDBZH9ZXZHX  $250 Cash   + 25,000 pts   102 = 250.00 (no entro nada)
--
--    create_accounting_entry_for_supplement lo decia en un comentario:
--    "payment_method = 'points' se deja SIN TOCAR ... Pendiente de definir con
--    el contador/Axel". Ya esta definido: es descuento absorbido por ToursRed,
--    y va a 603 (Gastos de marketing), la unica cuenta de gasto del catalogo
--    que corresponde a un programa de lealtad. Si el contador prefiere una
--    subcuenta propia, el cambio es el codigo de cuenta y nada mas.
--
-- 2. get_wallet_portion_for_booking_component repartia el Cash usando un
--    denominador que INCLUIA lo pagado con puntos, asi que con puntos, Cash y
--    extras en la misma reserva cada asiento quedaba descuadrado contra su
--    propio cobro (la suma de todos si cuadraba: patron 1). Se reemplaza en
--    los tres asientos que la usaban por reparto_saldo_de_reserva, que separa
--    primero la parte de puntos y reparte el Cash sobre el resto. La funcion
--    vieja se queda: no se borra nada que otro pueda estar llamando.
--
-- ============================================================================
-- QUE CAMBIA
-- ============================================================================
--
--   Columnas  points_used en booking_supplements, booking_optional_services y
--             booking_payment_plan_transactions; travel_insurance_points_used
--             y travel_insurance_cash_used en bookings (el seguro comprado
--             despues de reservar no tiene fila propia).
--   Cobro     cobrar_saldo_y_puntos: descuenta puntos y Cash en UNA
--             transaccion. Antes cada Edge Function hacia una sola llamada; con
--             dos medios, una falla a la mitad dejaria uno cobrado y el otro no.
--   Reembolso reembolsar_saldo_y_puntos: lo pagado con puntos regresa como
--             puntos, no como Cash, y quita los puntos que se ganaron con lo
--             que se devuelve. Las dos cancelaciones individuales devolvian
--             TODO en Cash (puntos convertidos en dinero) y su intento de
--             quitar los puntos ganados llamaba a deduct_points_for_booking
--             con un parametro p_user_id que no existe: fallaba siempre.
--   Abonos    allocate_payment_plan_installment recibe p_points_used: lo guarda
--             y lo cuenta como puntos sencillos (sin pasarela, el Cash va doble;
--             regla del 16-oct, ver 20261016023158).
--   Asientos  reserva, suplemento, servicio opcional, abono y seguro: la parte
--             de puntos va a 603 y deja de ir a Bancos o al monedero.

-- ============================================================================
-- 1. COLUMNAS
-- ============================================================================

ALTER TABLE public.booking_supplements
  ADD COLUMN IF NOT EXISTS points_used integer NOT NULL DEFAULT 0;
ALTER TABLE public.booking_supplements
  ADD CONSTRAINT booking_supplements_points_used_check CHECK (points_used >= 0);

ALTER TABLE public.booking_optional_services
  ADD COLUMN IF NOT EXISTS points_used integer NOT NULL DEFAULT 0;
ALTER TABLE public.booking_optional_services
  ADD CONSTRAINT booking_optional_services_points_used_check CHECK (points_used >= 0);

ALTER TABLE public.booking_payment_plan_transactions
  ADD COLUMN IF NOT EXISTS points_used integer NOT NULL DEFAULT 0;
ALTER TABLE public.booking_payment_plan_transactions
  ADD CONSTRAINT booking_payment_plan_transactions_points_used_check CHECK (points_used >= 0);

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS travel_insurance_points_used integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS travel_insurance_cash_used numeric NOT NULL DEFAULT 0;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_travel_insurance_points_used_check CHECK (travel_insurance_points_used >= 0),
  ADD CONSTRAINT bookings_travel_insurance_cash_used_check CHECK (travel_insurance_cash_used >= 0);

COMMENT ON COLUMN public.booking_supplements.points_used IS
  'Puntos ToursRed aplicados como descuento (100 pts = $1). total_paid es el valor completo; lo que salio del bolsillo es total_paid - points_used/100.';
COMMENT ON COLUMN public.booking_optional_services.points_used IS
  'Puntos ToursRed aplicados como descuento (100 pts = $1). total_paid es el valor completo.';
COMMENT ON COLUMN public.booking_payment_plan_transactions.points_used IS
  'Puntos ToursRed aplicados al abono (100 pts = $1). amount es el abono completo.';
COMMENT ON COLUMN public.bookings.travel_insurance_points_used IS
  'Puntos aplicados al seguro comprado DESPUES de reservar. El seguro contratado al reservar comparte bookings.points_used.';
COMMENT ON COLUMN public.bookings.travel_insurance_cash_used IS
  'ToursRed Cash aplicado al seguro comprado DESPUES de reservar. El de la reserva comparte bookings.toursred_cash_used.';

-- ============================================================================
-- 2. COBRO: puntos y Cash en una sola transaccion
-- ============================================================================
--
-- Reusa deduct_points y update_wallet_balance tal cual: los dos bloquean su
-- billetera, validan saldo y lanzan si no alcanza. Al vivir en una funcion,
-- cualquier excepcion revierte las dos cosas. Idempotente por las mismas
-- razones que ellas: deduct_points no repite un canje con la misma referencia
-- y update_wallet_balance no repite una llave de idempotencia.

CREATE OR REPLACE FUNCTION public.cobrar_saldo_y_puntos(
  p_user_id uuid,
  p_cash numeric,
  p_points integer,
  p_reference_id uuid,
  p_reference_type text,
  p_description text,
  p_idempotency_key text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cash   numeric := round(coalesce(p_cash, 0), 2);
  v_points integer := coalesce(p_points, 0);
BEGIN
  IF v_cash < 0 OR v_points < 0 THEN
    RAISE EXCEPTION 'Montos negativos: cash %, puntos %', v_cash, v_points;
  END IF;
  IF v_cash = 0 AND v_points = 0 THEN
    RAISE EXCEPTION 'Nada que cobrar';
  END IF;

  IF v_points > 0 THEN
    PERFORM public.deduct_points(p_user_id, v_points, p_description, p_reference_id, p_reference_type);
  END IF;

  IF v_cash > 0 THEN
    PERFORM public.update_wallet_balance(
      p_user_id, -v_cash, 'debit'::toursred_cash_transaction_type, p_description,
      p_reference_id, p_reference_type, p_idempotency_key
    );
  END IF;

  RETURN jsonb_build_object('cash', v_cash, 'points', v_points);
END;
$function$;

REVOKE ALL ON FUNCTION public.cobrar_saldo_y_puntos(uuid, numeric, integer, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cobrar_saldo_y_puntos(uuid, numeric, integer, uuid, text, text, text) TO service_role;

-- ============================================================================
-- 3. REEMBOLSO: el Cash regresa como Cash y los puntos como puntos
-- ============================================================================
--
-- p_points_return  puntos que se usaron para pagar lo cancelado: regresan.
-- p_points_clawback puntos que se GANARON con lo cancelado: se quitan. Si el
--                  viajero ya los gasto, se quita lo que haya (el saldo de
--                  puntos no puede quedar negativo, CHECK balance_after >= 0) y
--                  el resultado dice cuanto se quito de verdad.
--
-- El movimiento de regreso es type 'refund' (el que ya usa
-- refund_points_for_cancellation) y el de quitar es 'redeemed' con monto
-- negativo, el patron de traveler_cancellation (ver 20260908061655).

CREATE OR REPLACE FUNCTION public.reembolsar_saldo_y_puntos(
  p_user_id uuid,
  p_cash numeric,
  p_points_return integer,
  p_points_clawback integer,
  p_reference_id uuid,
  p_points_reference_type text,
  p_cash_reference_type text,
  p_description text,
  p_idempotency_key text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cash      numeric := round(coalesce(p_cash, 0), 2);
  v_return    integer := coalesce(p_points_return, 0);
  v_clawback  integer := coalesce(p_points_clawback, 0);
  v_quitado   integer := 0;
  v_wallet_id uuid;
  v_balance   integer;
  v_cash_tx   json;
BEGIN
  IF v_cash < 0 OR v_return < 0 OR v_clawback < 0 THEN
    RAISE EXCEPTION 'Montos negativos: cash %, regreso %, quitar %', v_cash, v_return, v_clawback;
  END IF;

  IF v_cash > 0 THEN
    v_cash_tx := public.update_wallet_balance(
      p_user_id, v_cash, 'refund'::toursred_cash_transaction_type, p_description,
      p_reference_id, p_cash_reference_type, p_idempotency_key
    );
  END IF;

  IF v_return > 0 OR v_clawback > 0 THEN
    v_wallet_id := public.get_or_create_points_wallet(p_user_id);
    SELECT balance INTO v_balance FROM public.toursred_points_wallets WHERE id = v_wallet_id FOR UPDATE;

    IF v_return > 0 THEN
      v_balance := v_balance + v_return;
      UPDATE public.toursred_points_wallets
         SET balance = v_balance,
             total_used = GREATEST(0, total_used - v_return),
             updated_at = now()
       WHERE id = v_wallet_id;
      INSERT INTO public.toursred_points_transactions (
        wallet_id, user_id, amount, balance_after, type, description, reference_id, reference_type
      ) VALUES (
        v_wallet_id, p_user_id, v_return, v_balance, 'refund',
        'Puntos devueltos: ' || p_description, p_reference_id, p_points_reference_type
      );
    END IF;

    v_quitado := LEAST(v_clawback, v_balance);
    IF v_quitado > 0 THEN
      v_balance := v_balance - v_quitado;
      UPDATE public.toursred_points_wallets
         SET balance = v_balance,
             total_used = total_used + v_quitado,
             updated_at = now()
       WHERE id = v_wallet_id;
      INSERT INTO public.toursred_points_transactions (
        wallet_id, user_id, amount, balance_after, type, description, reference_id, reference_type
      ) VALUES (
        v_wallet_id, p_user_id, -v_quitado, v_balance, 'redeemed',
        'Puntos ganados que se retiran: ' || p_description, p_reference_id, p_points_reference_type
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'cash', v_cash,
    'cash_transaction_id', v_cash_tx->>'transaction_id',
    'points_returned', v_return,
    'points_clawed_back', v_quitado
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.reembolsar_saldo_y_puntos(uuid, numeric, integer, integer, uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reembolsar_saldo_y_puntos(uuid, numeric, integer, integer, uuid, text, text, text, text) TO service_role;

-- ============================================================================
-- 4. ABONOS: allocate_payment_plan_installment conoce los puntos
-- ============================================================================
--
-- Copiada de pg_get_functiondef el 16-oct-2026. Cambia solo:
--   - el parametro nuevo p_points_used (al final, con DEFAULT 0, asi que los
--     llamadores actuales -capture-paypal-order, conekta-webhook y la propia
--     Edge Function, todos con argumentos nombrados- no cambian);
--   - el calculo de puntos ganados: sin pasarela el Cash va doble y lo pagado
--     con puntos sencillo, igual que award_points_for_booking (20261016023158);
--   - points_used se guarda en la transaccion.
-- p_amount sigue siendo el abono COMPLETO: los puntos pagan su parte, asi que
-- se reparte entero entre las parcialidades.
--
-- Con un parametro nuevo, CREATE OR REPLACE crearia una segunda funcion y toda
-- llamada sin p_points_used seria ambigua. Por eso DROP y CREATE, y se
-- reponen los permisos (service_role, como estaba).

DROP FUNCTION IF EXISTS public.allocate_payment_plan_installment(uuid, numeric, text, numeric, numeric, text, uuid, boolean, boolean);

CREATE FUNCTION public.allocate_payment_plan_installment(p_plan_id uuid, p_amount numeric, p_provider text, p_service_charge numeric DEFAULT 0, p_gross_service_charge numeric DEFAULT 0, p_provider_transaction_id text DEFAULT NULL::text, p_user_id uuid DEFAULT NULL::uuid, p_membership_exemption_used boolean DEFAULT false, p_is_wallet_payment boolean DEFAULT false, p_points_used integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_plan RECORD;
v_booking RECORD;
v_allocations jsonb := '[]'::jsonb;
v_remaining numeric := p_amount;
v_amount_owed numeric;
v_allocated numeric;
v_tx_id uuid;
v_points_earned integer := 0;
v_active_membership_id uuid;
v_wallet_id uuid;
v_wallet_balance integer;
v_wallet_total_earned integer;
v_new_balance integer;
v_total_paid numeric;
v_total_due numeric;
v_new_status text;
v_new_total_paid numeric;
v_plan_complete boolean;
v_existing_tx RECORD;
v_installment RECORD;
v_plan_total_amount numeric;
v_points_used integer := GREATEST(0, COALESCE(p_points_used, 0));
v_pesos_en_puntos numeric;
BEGIN
-- Load plan
SELECT * INTO v_plan FROM booking_payment_plans WHERE id = p_plan_id;
IF NOT FOUND THEN
RAISE EXCEPTION 'Plan de pago no encontrado';
END IF;

-- Load booking
SELECT * INTO v_booking FROM bookings WHERE id = v_plan.booking_id;
IF NOT FOUND THEN
RAISE EXCEPTION 'Reserva no encontrada';
END IF;

-- Idempotency: if provider_transaction_id already has a transaction, return it
IF p_provider_transaction_id IS NOT NULL THEN
SELECT id, points_earned INTO v_existing_tx
FROM booking_payment_plan_transactions
WHERE provider_transaction_id = p_provider_transaction_id
AND payment_provider = p_provider
LIMIT 1;

IF FOUND THEN
RETURN jsonb_build_object(
'transaction_id', v_existing_tx.id,
'points_earned', COALESCE(v_existing_tx.points_earned, 0),
'allocations', '[]'::jsonb,
'idempotent_skip', true
);
END IF;
END IF;

-- Puntos ganados: cada peso pagado da un punto. Sin pasarela el Cash va doble;
-- lo pagado con puntos siempre sencillo (100 pts = $1).
v_pesos_en_puntos := LEAST(v_points_used / 100.0, p_amount);
v_points_earned := 0;
IF p_user_id IS NOT NULL THEN
SELECT id INTO v_active_membership_id
FROM memberships
WHERE user_id = p_user_id
AND status = 'active'
AND current_period_end > now()
LIMIT 1;

IF v_active_membership_id IS NOT NULL THEN
IF p_is_wallet_payment THEN
v_points_earned := floor((p_amount - v_pesos_en_puntos) * 2 + v_pesos_en_puntos)::integer;
ELSE
v_points_earned := floor(p_amount + p_service_charge)::integer;
END IF;
END IF;
END IF;

-- Create the transaction record
INSERT INTO booking_payment_plan_transactions (
plan_id, booking_id, user_id, amount, service_charge, gross_service_charge,
payment_provider, provider_transaction_id,
membership_exemption_used, points_earned, status, points_used
) VALUES (
p_plan_id, v_plan.booking_id, p_user_id, p_amount, p_service_charge, p_gross_service_charge,
p_provider, p_provider_transaction_id,
p_membership_exemption_used, v_points_earned, 'completed', v_points_used
)
RETURNING id INTO v_tx_id;

-- Allocate payment chronologically (oldest first) using FOR loop over query
FOR v_installment IN
SELECT * FROM booking_payment_plan_installments
WHERE plan_id = p_plan_id
AND status IN ('overdue', 'overdue_grace', 'pending', 'partially_paid')
ORDER BY due_date ASC
LOOP
IF v_remaining <= 0 THEN EXIT; END IF;

v_amount_owed := COALESCE(v_installment.amount_due, 0) + COALESCE(v_installment.penalty_applied, 0) - COALESCE(v_installment.amount_paid, 0);
IF v_amount_owed <= 0 THEN CONTINUE; END IF;

v_allocated := LEAST(v_remaining, v_amount_owed);
v_allocated := round(v_allocated::numeric, 2);

-- Insert allocation record
INSERT INTO booking_payment_plan_transaction_allocations (
transaction_id, installment_id, amount_allocated
) VALUES (v_tx_id, v_installment.id, v_allocated);

-- Build allocation for return value
v_allocations := v_allocations || jsonb_build_object(
'installment_id', v_installment.id,
'amount_allocated', v_allocated
);

-- Update installment
v_total_paid := round((COALESCE(v_installment.amount_paid, 0) + v_allocated)::numeric, 2);
v_total_due := round((COALESCE(v_installment.amount_due, 0) + COALESCE(v_installment.penalty_applied, 0))::numeric, 2);

IF v_total_paid >= v_total_due THEN
v_new_status := 'paid';
UPDATE booking_payment_plan_installments
SET amount_paid = v_total_paid, status = v_new_status, paid_at = now(), updated_at = now()
WHERE id = v_installment.id;
ELSE
v_new_status := 'partially_paid';
UPDATE booking_payment_plan_installments
SET amount_paid = v_total_paid, status = v_new_status, updated_at = now()
WHERE id = v_installment.id;
END IF;

v_remaining := round((v_remaining - v_allocated)::numeric, 2);
END LOOP;

-- Update plan totals — pending_balance is GENERATED ALWAYS AS, do NOT write it manually
v_new_total_paid := round((COALESCE(v_plan.total_amount_paid, 0) + p_amount)::numeric, 2);
v_plan_total_amount := COALESCE(v_plan.total_plan_amount, 0);
v_plan_complete := v_new_total_paid >= v_plan_total_amount;

UPDATE booking_payment_plans
SET total_amount_paid = v_new_total_paid,
status = CASE WHEN v_plan_complete THEN 'completed' ELSE 'active' END,
updated_at = now()
WHERE id = p_plan_id;

-- Update booking
UPDATE bookings
SET payment_plan_paid = v_new_total_paid,
payment_plan_status = CASE WHEN v_plan_complete THEN 'completed' ELSE 'active' END,
updated_at = now()
WHERE id = v_plan.booking_id;

-- Award points if applicable
IF v_points_earned > 0 AND p_user_id IS NOT NULL THEN
SELECT get_or_create_points_wallet(p_user_id) INTO v_wallet_id;

IF v_wallet_id IS NOT NULL THEN
SELECT balance, total_earned INTO v_wallet_balance, v_wallet_total_earned
FROM toursred_points_wallets WHERE id = v_wallet_id;

v_new_balance := v_wallet_balance + v_points_earned;

INSERT INTO toursred_points_transactions (
wallet_id, user_id, amount, balance_after, type, description, reference_id, reference_type, expires_at
) VALUES (
v_wallet_id, p_user_id, v_points_earned, v_new_balance, 'earned',
'Puntos por abono a plan de pago',
v_tx_id,
'payment_plan',
(now() + interval '365 days')
);

UPDATE toursred_points_wallets
SET balance = v_new_balance, total_earned = v_wallet_total_earned + v_points_earned
WHERE id = v_wallet_id;
END IF;
END IF;

RETURN jsonb_build_object(
'transaction_id', v_tx_id,
'points_earned', v_points_earned,
'allocations', v_allocations,
'idempotent_skip', false
);
END;
$function$;

REVOKE ALL ON FUNCTION public.allocate_payment_plan_installment(uuid, numeric, text, numeric, numeric, text, uuid, boolean, boolean, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.allocate_payment_plan_installment(uuid, numeric, text, numeric, numeric, text, uuid, boolean, boolean, integer) TO service_role;

-- ============================================================================
-- 5. REPARTO DEL SALDO DE UNA RESERVA ENTRE SUS COMPONENTES
-- ============================================================================
--
-- Lo que se cobro al reservar (deposito + cargo por servicio + extras + seguro
-- + membresia) se pago con una mezcla de puntos, Cash y pasarela, y cada
-- componente tiene su propio asiento. Esta funcion dice cuanto de un
-- componente salio de puntos y cuanto de Cash.
--
-- Puntos: se aplicaron sobre deposito + extras + seguro + membresia, NUNCA
-- sobre el cargo por servicio (create_booking_atomic, v_net_before_charges).
-- p_base_puntos es la parte del componente que pudo pagarse con puntos (el
-- deposito sin su cargo por servicio, por ejemplo).
--
-- Cash: se reparte sobre lo que NO pagaron los puntos. La funcion vieja
-- (get_wallet_portion_for_booking_component) usaba el total con puntos como
-- denominador y descuadraba cada asiento en cuanto la reserva tenia puntos,
-- Cash y algun extra a la vez. Tampoco contaba la membresia.
--
-- El seguro comprado DESPUES de reservar con Cash o puntos se excluye: trae
-- sus propias columnas. El comprado despues con pasarela no se distingue del
-- de la reserva (mismo limite que tenia la funcion vieja).

CREATE OR REPLACE FUNCTION public.reparto_saldo_de_reserva(
  p_booking_id uuid,
  p_componente numeric,
  p_base_puntos numeric,
  OUT cash numeric,
  OUT puntos numeric
)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_b              record;
  v_extras         numeric := 0;
  v_seguro         numeric := 0;
  v_membresia      numeric := 0;
  v_base_puntos    numeric;
  v_total          numeric;
  v_puntos_mxn     numeric;
  v_cash_usado     numeric;
  v_sin_puntos     numeric;
  v_componente     numeric := GREATEST(0, COALESCE(p_componente, 0));
BEGIN
  cash := 0;
  puntos := 0;
  IF v_componente = 0 THEN
    RETURN;
  END IF;

  SELECT deposit_amount, service_charge, travel_insurance_included, travel_insurance_cost,
         toursred_cash_used, points_used, membership_purchased, membership_cost,
         travel_insurance_points_used, travel_insurance_cash_used
    INTO v_b
    FROM bookings WHERE id = p_booking_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Extras capturados al reservar (payment_method IS NULL); los comprados
  -- despues tienen su propio metodo de pago y su propio points_used. Medido el
  -- 16-oct: hoy ningun extra de reserva tiene paid_at, asi que esto suma 0
  -- (igual que en la funcion vieja); se conserva por si eso cambia.
  SELECT COALESCE(SUM(COALESCE(subtotal, total_paid)), 0) INTO v_extras
    FROM booking_optional_services
   WHERE booking_id = p_booking_id
     AND payment_method IS NULL
     AND paid_at IS NOT NULL
     AND COALESCE(is_cancelled, false) = false;

  IF COALESCE(v_b.travel_insurance_included, false)
     AND COALESCE(v_b.travel_insurance_points_used, 0) = 0
     AND COALESCE(v_b.travel_insurance_cash_used, 0) = 0 THEN
    v_seguro := COALESCE(v_b.travel_insurance_cost, 0);
  END IF;

  IF COALESCE(v_b.membership_purchased, false) THEN
    v_membresia := COALESCE(v_b.membership_cost, 0);
  END IF;

  v_base_puntos := COALESCE(v_b.deposit_amount, 0) + v_extras + v_seguro + v_membresia;
  v_total := v_base_puntos + COALESCE(v_b.service_charge, 0);
  v_puntos_mxn := LEAST(COALESCE(v_b.points_used, 0) / 100.0, v_base_puntos);
  v_cash_usado := COALESCE(v_b.toursred_cash_used, 0);

  IF v_puntos_mxn > 0 AND v_base_puntos > 0 THEN
    puntos := LEAST(
      GREATEST(0, COALESCE(p_base_puntos, 0)),
      v_componente,
      round(GREATEST(0, COALESCE(p_base_puntos, 0)) * v_puntos_mxn / v_base_puntos, 2)
    );
  END IF;

  v_sin_puntos := v_total - v_puntos_mxn;
  IF v_cash_usado > 0 AND v_sin_puntos > 0 THEN
    cash := LEAST(
      v_componente - puntos,
      round((v_componente - puntos) * LEAST(v_cash_usado, v_sin_puntos) / v_sin_puntos, 2)
    );
  END IF;
  cash := GREATEST(0, cash);
END;
$function$;

REVOKE ALL ON FUNCTION public.reparto_saldo_de_reserva(uuid, numeric, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reparto_saldo_de_reserva(uuid, numeric, numeric) TO service_role;

-- ============================================================================
-- 6. ASIENTOS: la parte pagada con puntos va a 603, no a Bancos
-- ============================================================================
--
-- Las cinco funciones se copiaron de pg_get_functiondef el 16-oct-2026. En
-- cada una cambia solo de donde sale cada debito; los creditos (208 anticipo,
-- 402 cargo por servicio, 201.01/401.02 del seguro) no cambian, porque la
-- agencia cobra completo: el descuento lo absorbe ToursRed.

-- 6.1 Reserva -----------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_accounting_entry_for_booking(p_booking_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_booking record;
v_cfdi_uuid text;
v_entry_id uuid;
v_entry_number text;
v_year integer;
v_month integer;
v_deposit numeric;
v_service_charge numeric;
v_total_received numeric;
v_wallet_used numeric;
v_points_used numeric;
v_reparto record;
v_processor_charged_amount numeric;
v_tx record;
v_processor_fee_total numeric;
v_fee_base numeric;
v_fee_iva numeric;
v_net_to_bank numeric;
v_line_number integer;
v_settings record;
v_is_wallet_payment boolean;
BEGIN
-- Verificar que no exista ya una poliza para este booking
IF EXISTS (
SELECT 1 FROM accounting_entries
WHERE source_type = 'booking' AND source_id = p_booking_id
AND entry_type = 'ingreso'
) THEN
RETURN NULL;
END IF;

-- Obtener datos del booking
SELECT b.*, t.name AS tour_name, TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) AS traveler_name
INTO v_booking
FROM bookings b
LEFT JOIN tours t ON t.id = b.tour_id
LEFT JOIN users u ON u.id = b.user_id
WHERE b.id = p_booking_id
AND b.payment_status = 'succeeded';

IF NOT FOUND THEN
RETURN NULL;
END IF;

-- Obtener UUID del CFDI si existe
SELECT uuid_fiscal INTO v_cfdi_uuid
FROM cfdi_invoices
WHERE booking_id = p_booking_id AND status = 'stamped'
LIMIT 1;

v_deposit := COALESCE(v_booking.deposit_amount, v_booking.total_price, 0);
v_service_charge := COALESCE(v_booking.service_charge, 0);
v_total_received := v_deposit + v_service_charge;

-- Cuanto de deposito + cargo por servicio salio de puntos y cuanto de Cash
-- (reparto_saldo_de_reserva). Los puntos solo pudieron pagar el deposito, no el
-- cargo por servicio. Lo que queda es lo que cobro la pasarela.
v_reparto := public.reparto_saldo_de_reserva(p_booking_id, v_total_received, v_deposit);
v_wallet_used := v_reparto.cash;
v_points_used := v_reparto.puntos;
v_processor_charged_amount := GREATEST(0, v_total_received - v_wallet_used - v_points_used);

-- Obtener la transaccion de pago mas reciente exitosa para este booking
SELECT * INTO v_tx
FROM payment_transactions
WHERE booking_id = p_booking_id
AND status = 'succeeded'
ORDER BY created_at DESC
LIMIT 1;

-- Determinar si el pago fue via wallet (sin procesador externo)
v_is_wallet_payment := v_tx.payment_processor IS NULL
OR v_tx.payment_processor = 'toursred_cash'
OR v_tx.charge_context = 'wallet_topup';

-- Calcular comision del procesador
v_processor_fee_total := 0;
v_fee_base := 0;
v_fee_iva := 0;

IF NOT v_is_wallet_payment AND v_tx.payment_processor IS NOT NULL AND v_processor_charged_amount > 0 THEN
IF v_tx.processor_fee_base IS NOT NULL THEN
v_fee_base := v_tx.processor_fee_base;
v_fee_iva := COALESCE(v_tx.processor_fee_iva, 0);
v_processor_fee_total := v_fee_base + v_fee_iva;
ELSIF v_tx.processor_fee IS NOT NULL AND v_tx.processor_fee > 0 THEN
v_fee_base := ROUND(v_tx.processor_fee / 1.16, 2);
v_fee_iva := v_tx.processor_fee - v_fee_base;
v_processor_fee_total := v_tx.processor_fee;
ELSE
SELECT * INTO v_settings FROM platform_settings LIMIT 1;

IF v_settings IS NOT NULL THEN
CASE v_tx.payment_processor
WHEN 'stripe' THEN
v_processor_fee_total := ROUND((v_processor_charged_amount * COALESCE(v_settings.stripe_commission_pct, 3.1034) / 100) + COALESCE(v_settings.stripe_commission_fixed, 2.5862), 2);
WHEN 'paypal' THEN
v_processor_fee_total := ROUND((v_processor_charged_amount * COALESCE(v_settings.paypal_commission_pct, 3.95) / 100) + COALESCE(v_settings.paypal_commission_fixed, 4.0), 2);
WHEN 'mercadopago' THEN
v_processor_fee_total := ROUND((v_processor_charged_amount * COALESCE(v_settings.mercadopago_commission_pct, 3.49) / 100) + COALESCE(v_settings.mercadopago_commission_fixed, 4.0), 2);
WHEN 'conekta' THEN
v_processor_fee_total := ROUND((v_processor_charged_amount * COALESCE(v_settings.conekta_commission_pct, 3.29) / 100) + COALESCE(v_settings.conekta_commission_fixed, 2.5), 2);
WHEN 'openpay' THEN
v_processor_fee_total := ROUND((v_processor_charged_amount * COALESCE(v_settings.openpay_commission_pct, 2.9) / 100) + COALESCE(v_settings.openpay_commission_fixed, 0), 2);
ELSE
v_processor_fee_total := 0;
END CASE;

IF v_processor_fee_total > 0 THEN
v_fee_base := ROUND(v_processor_fee_total / 1.16, 2);
v_fee_iva := v_processor_fee_total - v_fee_base;
END IF;
END IF;
END IF;
END IF;

v_net_to_bank := v_processor_charged_amount - v_processor_fee_total;

v_year := EXTRACT(YEAR FROM COALESCE(v_booking.paid_at, v_booking.created_at))::integer;
v_month := EXTRACT(MONTH FROM COALESCE(v_booking.paid_at, v_booking.created_at))::integer;

v_entry_number := generate_entry_number('ingreso', v_year, v_month);

INSERT INTO accounting_entries (
entry_number, entry_type, entry_date, period_year, period_month,
description, source_type, source_id, is_posted
)
VALUES (
v_entry_number,
'ingreso',
COALESCE(v_booking.paid_at::date, v_booking.created_at::date),
v_year,
v_month,
'Anticipo reserva ' || COALESCE(v_booking.booking_code, p_booking_id::text) ||
' — ' || COALESCE(v_booking.tour_name, 'Tour'),
'booking',
p_booking_id,
true
)
RETURNING id INTO v_entry_id;

v_line_number := 1;

IF v_net_to_bank > 0 THEN
INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
VALUES (v_entry_id, v_line_number, '102',
'Cobro anticipo viajero ' || COALESCE(v_booking.traveler_name, '') ||
CASE WHEN v_processor_fee_total > 0 THEN ' (neto tras comision pasarela)' ELSE '' END ||
CASE WHEN v_wallet_used > 0 THEN ' (parcial, resto via ToursRed Cash)' ELSE '' END,
v_net_to_bank, 0, v_cfdi_uuid);
v_line_number := v_line_number + 1;
END IF;

IF v_wallet_used > 0 THEN
INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
VALUES (v_entry_id, v_line_number, '218-11',
'Aplicacion de saldo ToursRed Cash — reserva ' || COALESCE(v_booking.booking_code, ''),
v_wallet_used, 0, v_cfdi_uuid);
v_line_number := v_line_number + 1;
END IF;

IF v_points_used > 0 THEN
INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
VALUES (v_entry_id, v_line_number, '603',
'Descuento por ToursRed Points absorbido por ToursRed — reserva ' || COALESCE(v_booking.booking_code, ''),
v_points_used, 0, v_cfdi_uuid);
v_line_number := v_line_number + 1;
END IF;

IF v_fee_base > 0 THEN
INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
VALUES (v_entry_id, v_line_number, '604',
'Comision pasarela ' || COALESCE(v_tx.payment_processor, '') || ' — reserva ' || COALESCE(v_booking.booking_code, ''),
v_fee_base, 0, v_cfdi_uuid);
v_line_number := v_line_number + 1;
END IF;

IF v_fee_iva > 0 THEN
INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
VALUES (v_entry_id, v_line_number, '108',
'IVA acreditable comision pasarela ' || COALESCE(v_tx.payment_processor, ''),
v_fee_iva, 0, v_cfdi_uuid);
v_line_number := v_line_number + 1;
END IF;

IF v_deposit > 0 THEN
INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
VALUES (v_entry_id, v_line_number, '208',
'Anticipo pendiente de devengarse — reserva ' || COALESCE(v_booking.booking_code, ''),
0, v_deposit, v_cfdi_uuid);
v_line_number := v_line_number + 1;
END IF;

IF v_service_charge > 0 THEN
INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
VALUES (v_entry_id, v_line_number, '402',
'Cargo de servicio plataforma — reserva ' || COALESCE(v_booking.booking_code, ''),
0, v_service_charge, v_cfdi_uuid);
END IF;

RETURN v_entry_id;
END;
$function$;

-- 6.2 Suplemento --------------------------------------------------------------
--
-- total_paid es el valor completo del suplemento. La parte de puntos
-- (points_used/100) va a 603; el resto, al monedero si se pago con Cash o a
-- Bancos si fue pasarela. Un suplemento viejo pagado 100% con puntos
-- (payment_method = 'points', anterior a points_used) se registra entero en 603:
-- antes iba a Bancos.

CREATE OR REPLACE FUNCTION public.create_accounting_entry_for_supplement(p_supplement_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_supp record;
v_booking record;
v_cfdi_uuid text;
v_entry_id uuid;
v_entry_number text;
v_year integer;
v_month integer;
v_net_amount numeric;
v_service_charge numeric;
v_commission numeric;
v_agency_net numeric;
v_tour_name text;
v_agency_name text;
v_total numeric;
v_points_mxn numeric;
v_paid_part numeric;
v_debit_account_code text;
v_debit_description text;
v_line_number integer;
BEGIN
-- Idempotencia: no duplicar
IF EXISTS (
SELECT 1 FROM accounting_entries ae
WHERE ae.source_type = 'supplement' AND ae.source_id = p_supplement_id
) THEN
RETURN NULL;
END IF;

SELECT bs.*, t.name AS tour_name, ag.name AS agency_name
INTO v_supp
FROM booking_supplements bs
LEFT JOIN bookings b ON b.id = bs.booking_id
LEFT JOIN tours t ON t.id = b.tour_id
LEFT JOIN agencies ag ON ag.id = b.agency_id
WHERE bs.id = p_supplement_id AND bs.status = 'paid';

IF NOT FOUND THEN
RETURN NULL;
END IF;

SELECT * INTO v_booking FROM bookings WHERE id = v_supp.booking_id;
IF NOT FOUND THEN RETURN NULL; END IF;

-- CFDI del suplemento si existe
SELECT uuid_fiscal INTO v_cfdi_uuid
FROM cfdi_invoices
WHERE booking_supplement_id = p_supplement_id AND status = 'stamped'
LIMIT 1;

v_net_amount := COALESCE(v_supp.total_paid, 0) - COALESCE(v_supp.service_charge, 0);
v_service_charge := COALESCE(v_supp.service_charge, 0);
v_commission := COALESCE(v_supp.supplement_commission, 0);
v_agency_net := v_net_amount - v_commission;
v_total := v_net_amount + v_service_charge;

IF v_net_amount <= 0 THEN
RETURN NULL;
END IF;

IF v_supp.payment_method = 'points' AND COALESCE(v_supp.points_used, 0) = 0 THEN
v_points_mxn := v_total;
ELSE
v_points_mxn := LEAST(v_total, COALESCE(v_supp.points_used, 0) / 100.0);
END IF;
v_paid_part := v_total - v_points_mxn;

IF v_supp.payment_method = 'toursred_cash' THEN
v_debit_account_code := '218-11';
v_debit_description := 'Aplicacion de saldo ToursRed Cash — suplemento';
ELSE
v_debit_account_code := '102';
v_debit_description := 'Cobro suplemento viajero';
END IF;

v_year := EXTRACT(YEAR FROM COALESCE(v_supp.paid_at, CURRENT_TIMESTAMP))::integer;
v_month := EXTRACT(MONTH FROM COALESCE(v_supp.paid_at, CURRENT_TIMESTAMP))::integer;
v_entry_number := generate_entry_number('ingreso', v_year, v_month);

INSERT INTO accounting_entries (
entry_number, entry_type, entry_date, period_year, period_month,
description, source_type, source_id, is_posted
) VALUES (
v_entry_number, 'ingreso',
COALESCE(v_supp.paid_at::date, CURRENT_DATE),
v_year, v_month,
'Suplemento pagado — ' || COALESCE(v_tour_name, v_supp.tour_name, '') ||
' — Reserva: ' || COALESCE(v_booking.booking_code, v_supp.booking_id::text),
'supplement', p_supplement_id, true
) RETURNING id INTO v_entry_id;

v_line_number := 1;

-- Débito: Bancos, o ToursRed Cash si se pago con monedero (lo que no cubrieron los puntos)
IF v_paid_part > 0 THEN
INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
VALUES (v_entry_id, v_line_number, v_debit_account_code, v_debit_description, v_paid_part, 0, v_cfdi_uuid);
v_line_number := v_line_number + 1;
END IF;

-- Débito: descuento por puntos, absorbido por ToursRed
IF v_points_mxn > 0 THEN
INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
VALUES (v_entry_id, v_line_number, '603', 'Descuento por ToursRed Points absorbido por ToursRed — suplemento', v_points_mxn, 0, v_cfdi_uuid);
v_line_number := v_line_number + 1;
END IF;

-- Crédito: Ingreso por cargo de servicio (402)
IF v_service_charge > 0 THEN
INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
VALUES (v_entry_id, v_line_number, '402', 'Cargo de servicio — suplemento', 0, v_service_charge, v_cfdi_uuid);
v_line_number := v_line_number + 1;
END IF;

-- Crédito: Anticipos de clientes (208) — solo el neto, el service charge ya fue a 402
INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
VALUES (v_entry_id, v_line_number, '208', 'Anticipo pendiente — suplemento', 0, v_net_amount, v_cfdi_uuid);

RETURN v_entry_id;
END;
$function$;

-- 6.3 Servicio opcional -------------------------------------------------------
--
-- Comprado despues de reservar (payment_method propio): sus puntos son
-- points_used. Capturado al reservar (payment_method IS NULL): comparte puntos y
-- Cash de la reserva, y se reparte con reparto_saldo_de_reserva.

CREATE OR REPLACE FUNCTION public.create_accounting_entry_for_optional_service(p_bos_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_bos record;
v_booking record;
v_cfdi_uuid text;
v_entry_id uuid;
v_entry_number text;
v_year integer;
v_month integer;
v_net_amount numeric;
v_service_charge numeric;
v_total_amount numeric;
v_wallet_used numeric;
v_points_mxn numeric;
v_reparto record;
v_bank_portion numeric;
v_line_number integer;
BEGIN
IF EXISTS (
SELECT 1 FROM accounting_entries ae
WHERE ae.source_type = 'optional_service' AND ae.source_id = p_bos_id
) THEN
RETURN NULL;
END IF;

SELECT bos.*, t.name AS tour_name
INTO v_bos
FROM booking_optional_services bos
LEFT JOIN bookings b ON b.id = bos.booking_id
LEFT JOIN tours t ON t.id = b.tour_id
WHERE bos.id = p_bos_id AND bos.paid_at IS NOT NULL AND bos.is_cancelled = false;

IF NOT FOUND THEN
RETURN NULL;
END IF;

SELECT * INTO v_booking FROM bookings WHERE id = v_bos.booking_id;
IF NOT FOUND THEN RETURN NULL; END IF;

SELECT uuid_fiscal INTO v_cfdi_uuid
FROM cfdi_invoices
WHERE booking_optional_service_id = p_bos_id AND status = 'stamped'
LIMIT 1;

v_net_amount := COALESCE(v_bos.total_paid, 0) - COALESCE(v_bos.service_charge, 0);
v_service_charge := COALESCE(v_bos.service_charge, 0);
v_total_amount := v_net_amount + v_service_charge;

IF v_net_amount <= 0 THEN
RETURN NULL;
END IF;

-- Puntos: los propios si se compro despues de reservar; un extra viejo pagado
-- 100% con puntos (payment_method = 'points', anterior a points_used) es
-- descuento completo.
IF v_bos.payment_method IS NULL THEN
v_reparto := public.reparto_saldo_de_reserva(v_bos.booking_id, v_total_amount, v_net_amount);
v_points_mxn := v_reparto.puntos;
v_wallet_used := v_reparto.cash;
ELSIF v_bos.payment_method = 'points' AND COALESCE(v_bos.points_used, 0) = 0 THEN
v_points_mxn := v_total_amount;
v_wallet_used := 0;
ELSE
v_points_mxn := LEAST(v_total_amount, COALESCE(v_bos.points_used, 0) / 100.0);
IF v_bos.payment_method = 'toursred_cash' THEN
v_wallet_used := v_total_amount - v_points_mxn;
ELSE
v_wallet_used := 0;
END IF;
END IF;

v_bank_portion := v_total_amount - v_wallet_used - v_points_mxn;

v_year := EXTRACT(YEAR FROM COALESCE(v_bos.paid_at, CURRENT_TIMESTAMP))::integer;
v_month := EXTRACT(MONTH FROM COALESCE(v_bos.paid_at, CURRENT_TIMESTAMP))::integer;
v_entry_number := generate_entry_number('ingreso', v_year, v_month);

INSERT INTO accounting_entries (
entry_number, entry_type, entry_date, period_year, period_month,
description, source_type, source_id, is_posted
) VALUES (
v_entry_number, 'ingreso',
COALESCE(v_bos.paid_at::date, CURRENT_DATE),
v_year, v_month,
'Servicio opcional pagado — ' || COALESCE(v_bos.description, 'Servicio') ||
' — Reserva: ' || COALESCE(v_booking.booking_code, v_bos.booking_id::text),
'optional_service', p_bos_id, true
) RETURNING id INTO v_entry_id;

v_line_number := 1;

IF v_bank_portion > 0 THEN
INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
VALUES (v_entry_id, v_line_number, '102', 'Cobro servicio opcional viajero', v_bank_portion, 0, v_cfdi_uuid);
v_line_number := v_line_number + 1;
END IF;

IF v_wallet_used > 0 THEN
INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
VALUES (v_entry_id, v_line_number, '218-11', 'Aplicacion de saldo ToursRed Cash — servicio opcional', v_wallet_used, 0, v_cfdi_uuid);
v_line_number := v_line_number + 1;
END IF;

IF v_points_mxn > 0 THEN
INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
VALUES (v_entry_id, v_line_number, '603', 'Descuento por ToursRed Points absorbido por ToursRed — servicio opcional', v_points_mxn, 0, v_cfdi_uuid);
v_line_number := v_line_number + 1;
END IF;

IF v_service_charge > 0 THEN
INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
VALUES (v_entry_id, v_line_number, '402', 'Cargo de servicio — servicio opcional', 0, v_service_charge, v_cfdi_uuid);
v_line_number := v_line_number + 1;
END IF;

INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
VALUES (v_entry_id, v_line_number, '208', 'Anticipo pendiente — servicio opcional', 0, v_net_amount, v_cfdi_uuid);

RETURN v_entry_id;
END;
$function$;

-- 6.4 Abono de plan de pagos --------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_accounting_entry_for_payment_plan_installment(p_installment_tx_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tx record;
  v_entry_id uuid;
  v_debit text;
  v_total numeric;
  v_service numeric;
  v_net numeric;
  v_points_mxn numeric;
  v_paid_part numeric;
  v_lines jsonb := '[]'::jsonb;
BEGIN
  SELECT bpt.*, b.booking_code
  INTO v_tx
  FROM booking_payment_plan_transactions bpt
  JOIN bookings b ON b.id = bpt.booking_id
  WHERE bpt.id = p_installment_tx_id AND bpt.status IN ('completed', 'succeeded');
  IF NOT FOUND THEN RETURN NULL; END IF;

  v_total := COALESCE(v_tx.total_charged, 0);
  v_service := COALESCE(v_tx.service_charge, 0);
  v_net := v_total - v_service;
  IF v_net <= 0 THEN RETURN NULL; END IF;
  v_debit := CASE WHEN v_tx.payment_provider = 'toursred_cash' THEN '218-11' ELSE '102' END;

  -- Puntos: descuento absorbido por ToursRed (603). Un abono viejo pagado 100%
  -- con puntos (payment_provider = 'points', anterior a points_used) es
  -- descuento completo; antes se cargaba a Bancos.
  IF v_tx.payment_provider = 'points' AND COALESCE(v_tx.points_used, 0) = 0 THEN
    v_points_mxn := v_total;
  ELSE
    v_points_mxn := LEAST(v_total, COALESCE(v_tx.points_used, 0) / 100.0);
  END IF;
  v_paid_part := v_total - v_points_mxn;

  SELECT id INTO v_entry_id
  FROM accounting_entries
  WHERE source_type = 'payment_plan_installment' AND source_id = p_installment_tx_id
  LIMIT 1;
  IF v_entry_id IS NOT NULL THEN RETURN NULL; END IF;

  IF v_paid_part > 0 THEN
    v_lines := v_lines || jsonb_build_object('account_code', v_debit, 'description', 'Cobro abono plan de pagos viajero', 'debit', v_paid_part, 'credit', 0);
  END IF;
  IF v_points_mxn > 0 THEN
    v_lines := v_lines || jsonb_build_object('account_code', '603', 'description', 'Descuento por ToursRed Points absorbido por ToursRed — abono plan de pagos', 'debit', v_points_mxn, 'credit', 0);
  END IF;
  v_lines := v_lines
    || jsonb_build_object('account_code', '402', 'description', 'Cargo de servicio — abono plan de pagos', 'debit', 0, 'credit', v_service)
    || jsonb_build_object('account_code', '208', 'description', 'Anticipo pendiente — abono plan de pagos', 'debit', 0, 'credit', v_net);

  RETURN public.create_accounting_entry_atomic(
    'ingreso',
    'Abono plan de pagos — Reserva: ' || COALESCE(v_tx.booking_code, v_tx.booking_id::text),
    'payment_plan_installment',
    p_installment_tx_id,
    COALESCE(v_tx.created_at::date, current_date),
    v_lines
  );
END;
$function$;

-- 6.5 Seguro de viaje ---------------------------------------------------------
--
-- El comprado despues de reservar con Cash y/o puntos trae sus propias columnas
-- (travel_insurance_cash_used, travel_insurance_points_used). El de la reserva
-- comparte el saldo de la reserva y se reparte con reparto_saldo_de_reserva.

CREATE OR REPLACE FUNCTION public.create_accounting_entry_for_insurance_purchase(p_booking_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_booking record;
v_cfdi_uuid text;
v_entry_id uuid;
v_entry_number text;
v_year integer;
v_month integer;
v_insurance_cost numeric;
v_insurance_price_per_unit numeric;
v_insurance_cost_per_unit numeric;
v_insurance_units numeric;
v_insurance_liability numeric;
v_insurance_income numeric;
v_wallet_used numeric;
v_points_mxn numeric;
v_reparto record;
v_bank_portion numeric;
v_line_number integer;
BEGIN
IF EXISTS (
SELECT 1 FROM accounting_entries ae
WHERE ae.source_type = 'insurance' AND ae.source_id = p_booking_id
) THEN
RETURN NULL;
END IF;

SELECT b.*, t.name AS tour_name
INTO v_booking
FROM bookings b
LEFT JOIN tours t ON t.id = b.tour_id
WHERE b.id = p_booking_id
AND b.travel_insurance_included = true
AND COALESCE(b.travel_insurance_cost, 0) > 0;

IF NOT FOUND THEN
RETURN NULL;
END IF;

SELECT uuid_fiscal INTO v_cfdi_uuid
FROM cfdi_invoices
WHERE booking_id = p_booking_id AND invoice_type = 'insurance' AND status = 'stamped'
LIMIT 1;

v_insurance_cost := COALESCE(v_booking.travel_insurance_cost, 0);

-- Reconocimiento inmediato (restaurado el 30-ago-2026): lo que se le debe a la
-- aseguradora (201.01) y el spread de ToursRed (401.02), con la razon
-- precio/costo por dia por viajero de platform_settings.
SELECT travel_insurance_price_per_day_per_traveler, travel_insurance_cost_per_day_per_traveler
INTO v_insurance_price_per_unit, v_insurance_cost_per_unit
FROM platform_settings LIMIT 1;

v_insurance_price_per_unit := COALESCE(v_insurance_price_per_unit, 79.00);
v_insurance_cost_per_unit := COALESCE(v_insurance_cost_per_unit, 59.00);

IF v_insurance_price_per_unit > 0 THEN
v_insurance_units := v_insurance_cost / v_insurance_price_per_unit;
ELSE
v_insurance_units := 0;
END IF;

v_insurance_liability := ROUND(v_insurance_units * v_insurance_cost_per_unit, 2);
IF v_insurance_liability > v_insurance_cost THEN
v_insurance_liability := v_insurance_cost;
END IF;
v_insurance_income := v_insurance_cost - v_insurance_liability;

IF COALESCE(v_booking.travel_insurance_points_used, 0) > 0
   OR COALESCE(v_booking.travel_insurance_cash_used, 0) > 0 THEN
v_points_mxn := LEAST(v_insurance_cost, COALESCE(v_booking.travel_insurance_points_used, 0) / 100.0);
v_wallet_used := LEAST(v_insurance_cost - v_points_mxn, COALESCE(v_booking.travel_insurance_cash_used, 0));
ELSE
v_reparto := public.reparto_saldo_de_reserva(p_booking_id, v_insurance_cost, v_insurance_cost);
v_points_mxn := v_reparto.puntos;
v_wallet_used := v_reparto.cash;
END IF;
v_bank_portion := v_insurance_cost - v_wallet_used - v_points_mxn;

v_year := EXTRACT(YEAR FROM COALESCE(v_booking.paid_at, v_booking.created_at))::integer;
v_month := EXTRACT(MONTH FROM COALESCE(v_booking.paid_at, v_booking.created_at))::integer;
v_entry_number := generate_entry_number('ingreso', v_year, v_month);

INSERT INTO accounting_entries (
entry_number, entry_type, entry_date, period_year, period_month,
description, source_type, source_id, is_posted
) VALUES (
v_entry_number, 'ingreso',
COALESCE(v_booking.paid_at::date, v_booking.created_at::date),
v_year, v_month,
'Seguro de viaje — ' || COALESCE(v_booking.tour_name, '') ||
' — Reserva: ' || COALESCE(v_booking.booking_code, p_booking_id::text),
'insurance', p_booking_id, true
) RETURNING id INTO v_entry_id;

v_line_number := 1;

-- Débito: Bancos (solo la parte que realmente entro via procesador)
IF v_bank_portion > 0 THEN
INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
VALUES (v_entry_id, v_line_number, '102', 'Cobro seguro de viaje viajero', v_bank_portion, 0, v_cfdi_uuid);
v_line_number := v_line_number + 1;
END IF;

-- Débito: ToursRed Cash por la parte pagada con monedero
IF v_wallet_used > 0 THEN
INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
VALUES (v_entry_id, v_line_number, '218-11', 'Aplicacion de saldo ToursRed Cash — seguro de viaje', v_wallet_used, 0, v_cfdi_uuid);
v_line_number := v_line_number + 1;
END IF;

-- Débito: descuento por puntos, absorbido por ToursRed
IF v_points_mxn > 0 THEN
INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
VALUES (v_entry_id, v_line_number, '603', 'Descuento por ToursRed Points absorbido por ToursRed — seguro de viaje', v_points_mxn, 0, v_cfdi_uuid);
v_line_number := v_line_number + 1;
END IF;

-- Crédito: Aseguradoras (201.01) — lo que se le debe a Universal Assistance
IF v_insurance_liability > 0 THEN
INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
VALUES (v_entry_id, v_line_number, '201.01',
'Prima de seguro de viaje pendiente de liquidar a aseguradora — reserva ' || COALESCE(v_booking.booking_code, ''),
0, v_insurance_liability, v_cfdi_uuid);
v_line_number := v_line_number + 1;
END IF;

-- Crédito: Ingresos por intermediacion de seguros (401.02) — spread de ToursRed
IF v_insurance_income > 0 THEN
INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
VALUES (v_entry_id, v_line_number, '401.02',
'Spread por intermediacion de seguro de viaje — reserva ' || COALESCE(v_booking.booking_code, ''),
0, v_insurance_income, v_cfdi_uuid);
END IF;

RETURN v_entry_id;
END;
$function$;
