-- ============================================================================
-- Pagar un gasto de operacion: despues de registrarlo, y en parcialidades
-- ============================================================================
--
-- QUE FALTABA
--
-- `gastos_operacion` tiene `pagado_en` desde `20260910240000`, y si se llena AL
-- CAPTURAR el asiento abona directo a `102 Bancos`. Lo que no existia era todo
-- lo demas:
--
--   * marcar pagado un gasto YA REGISTRADO. La pantalla solo ofrece «Editar»
--     en estado borrador, y `registrar_gasto_operacion` sale temprano si el
--     gasto ya esta registrado. No habia camino.
--   * PAGOS PARCIALES. `pagado_en` es una fecha: sabe decir «pagado» o «no
--     pagado», no «van 100 de 232».
--
-- Y un comentario de aquella migracion afirmaba que «cuando se pague, se edita
-- el gasto con su `pagado_en` y el asiento cambia de '205' a '102'». **Eso es
-- falso**: una poliza publicada es inmutable, y el asiento no cambia nunca.
-- Peor todavia, el atajo que ese comentario sugiere —un UPDATE directo a
-- `pagado_en`— SEPARA la vista del libro: el bloque 19 decide caja contra
-- pasivo con ese campo, asi que la vista pasaria a decir «salieron 232 del
-- banco» mientras el libro sigue diciendo «le debo 232 a TikTok». Las dos
-- cuadran solas. Mismo patron que ya mordio cuatro veces en este repo.
--
-- ----------------------------------------------------------------------------
-- EL MODELO: UNA FILA POR PAGO, Y `pagado_en` PASA A SER DERIVADO
-- ----------------------------------------------------------------------------
--
-- `pagos_de_gasto` guarda un renglon por cada pago, con su propio asiento:
--
--     205 Acreedores diversos   D  monto
--     102 Bancos                H  monto
--
-- `pagado_en` se conserva —la pantalla y los reportes lo leen— pero ahora
-- significa «fecha en que quedo saldado», y lo escribe la funcion cuando la
-- suma de pagos alcanza el total. Nadie lo pone a mano: asi no se puede
-- escribir «pagado» sin su asiento, que es justo la trampa de arriba.
--
-- **El gasto capturado YA PAGADO tambien genera su fila de pago.** Es la parte
-- menos obvia: ese camino abona directo a 102 y nunca crea deuda, asi que no
-- hay nada que saldar despues. Pero si no dejara rastro en `pagos_de_gasto`,
-- la vista —que ahora suma pagos— lo veria como no pagado. El modelo tiene que
-- ser uniforme o el reporte miente. Por eso `registrar_gasto_operacion`
-- inserta la fila apuntando al MISMO asiento, sin generar uno segundo.
--
-- ----------------------------------------------------------------------------
-- LO QUE LA FUNCION NO DEJA HACER
-- ----------------------------------------------------------------------------
--
--   * pagar mas que el saldo — un sobrepago dejaria `205` en deudor, que es
--     decir que el proveedor te debe a ti;
--   * pagar un gasto en borrador — todavia no hay deuda que saldar;
--   * pagar uno cancelado;
--   * pagar con fecha anterior al gasto — el pago no antecede a la factura.
--
-- Todo con mensajes en español: los que ve el usuario en la pantalla.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. La tabla
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pagos_de_gasto (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gasto_id    uuid NOT NULL REFERENCES public.gastos_operacion(id) ON DELETE RESTRICT,
  fecha       date NOT NULL,
  monto_mxn   numeric(14,2) NOT NULL,
  metodo_pago text,
  referencia  text,
  -- El asiento que respalda el pago. En el camino «capturado ya pagado» apunta
  -- al asiento del PROPIO gasto, que ya abono a 102: no hay un segundo asiento
  -- porque no hubo deuda intermedia.
  asiento_id  uuid REFERENCES public.accounting_entries(id),
  creado_por  uuid REFERENCES public.users(id) DEFAULT auth.uid(),
  created_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pagos_monto_positivo CHECK (monto_mxn > 0),
  CONSTRAINT pagos_tiene_asiento  CHECK (asiento_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS pagos_de_gasto_por_gasto ON public.pagos_de_gasto(gasto_id);

COMMENT ON TABLE public.pagos_de_gasto IS
  'Un renglon por cada pago hecho a un gasto de operacion, con su asiento. Permite parcialidades. gastos_operacion.pagado_en queda como la fecha en que la suma alcanzo el total, y lo escribe pagar_gasto_operacion: nunca a mano.';

ALTER TABLE public.pagos_de_gasto ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pagos_de_gasto_lectura ON public.pagos_de_gasto;
CREATE POLICY pagos_de_gasto_lectura ON public.pagos_de_gasto
  FOR SELECT TO authenticated
  USING (public.puede_gestionar_gastos());

-- Sin politicas de INSERT/UPDATE/DELETE a proposito: los pagos SOLO entran por
-- `pagar_gasto_operacion`, que es SECURITY DEFINER y crea el asiento en la
-- misma transaccion. Un INSERT suelto dejaria un pago sin respaldo contable.
REVOKE ALL ON public.pagos_de_gasto FROM PUBLIC, anon;
GRANT SELECT ON public.pagos_de_gasto TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Pagar (total o parcial)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pagar_gasto_operacion(
  p_gasto_id   uuid,
  p_fecha      date,
  p_monto_mxn  numeric,
  p_metodo     text DEFAULT NULL,
  p_referencia text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_g        record;
  v_pagado   numeric;
  v_saldo    numeric;
  v_asiento  uuid;
  v_numero   text;
  v_pago     uuid;
BEGIN
  IF NOT public.puede_gestionar_gastos() THEN
    RAISE EXCEPTION 'No tienes permiso para registrar pagos de gastos.'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_g FROM public.gastos_operacion WHERE id = p_gasto_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El gasto no existe.' USING ERRCODE = 'P0002';
  END IF;

  IF v_g.estado = 'borrador' THEN
    RAISE EXCEPTION 'Registra el gasto antes de pagarlo: un borrador todavia no genero la deuda.';
  END IF;
  IF v_g.estado = 'cancelado' THEN
    RAISE EXCEPTION 'El gasto esta cancelado y no se puede pagar.';
  END IF;

  IF p_monto_mxn IS NULL OR p_monto_mxn <= 0 THEN
    RAISE EXCEPTION 'El monto del pago tiene que ser mayor que cero.';
  END IF;

  IF p_fecha < v_g.fecha THEN
    RAISE EXCEPTION 'El pago (%) no puede ser anterior al gasto (%).', p_fecha, v_g.fecha;
  END IF;

  SELECT coalesce(sum(monto_mxn), 0) INTO v_pagado
  FROM public.pagos_de_gasto WHERE gasto_id = p_gasto_id;

  v_saldo := round(v_g.total_mxn - v_pagado, 2);

  IF v_saldo <= 0 THEN
    RAISE EXCEPTION 'Este gasto ya esta pagado por completo.';
  END IF;

  -- Un sobrepago dejaria 205 en deudor, o sea diciendo que el proveedor te debe
  -- a ti. Se rechaza con el saldo a la vista para que el usuario corrija.
  IF round(p_monto_mxn, 2) > v_saldo THEN
    RAISE EXCEPTION 'El pago (%) excede el saldo pendiente (%).',
      round(p_monto_mxn, 2), v_saldo;
  END IF;

  v_numero := public.generate_entry_number(
                'egreso',
                extract(year  FROM p_fecha)::int,
                extract(month FROM p_fecha)::int);

  INSERT INTO public.accounting_entries (
    entry_number, entry_type, entry_date, period_year, period_month,
    description, source_type, source_id, is_posted, posted_at
  ) VALUES (
    v_numero, 'egreso', p_fecha,
    extract(year FROM p_fecha)::int, extract(month FROM p_fecha)::int,
    'Pago a ' || v_g.proveedor || ' — ' || v_g.descripcion,
    'gasto_operacion',
    -- El source_id es el ID DEL PAGO, no el del gasto: el gasto ya uso su
    -- pareja (gasto_operacion, gasto_id) en el asiento de devengo, y repetirla
    -- chocaria con la idempotencia. Con parcialidades ademas hay varios pagos
    -- por gasto, asi que la unica llave estable es la del pago.
    gen_random_uuid(),
    true, now()
  ) RETURNING id INTO v_asiento;

  INSERT INTO public.accounting_entry_lines (
    entry_id, line_number, account_code, description, debit, credit
  ) VALUES
    (v_asiento, 1, '205',
     'Pago a ' || v_g.proveedor, round(p_monto_mxn, 2), 0),
    (v_asiento, 2, '102',
     'Salida de banco — ' || coalesce(p_metodo, 'sin metodo')
       || coalesce(' ref ' || p_referencia, ''), 0, round(p_monto_mxn, 2));

  INSERT INTO public.pagos_de_gasto (
    gasto_id, fecha, monto_mxn, metodo_pago, referencia, asiento_id
  ) VALUES (
    p_gasto_id, p_fecha, round(p_monto_mxn, 2), p_metodo, p_referencia, v_asiento
  ) RETURNING id INTO v_pago;

  -- `source_id` del asiento apunta al pago que lo origino. Se escribe despues
  -- porque el id del pago no existe hasta este punto.
  UPDATE public.accounting_entries SET source_id = v_pago WHERE id = v_asiento;

  -- `pagado_en` solo cuando el saldo llega a cero. Si queda parcial, el gasto
  -- sigue apareciendo como deuda por su resto, que es lo correcto.
  IF round(v_pagado + p_monto_mxn, 2) >= round(v_g.total_mxn, 2) THEN
    UPDATE public.gastos_operacion
       SET pagado_en = p_fecha,
           metodo_pago = coalesce(metodo_pago, p_metodo),
           updated_at = now()
     WHERE id = p_gasto_id;
  END IF;

  RETURN v_pago;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.pagar_gasto_operacion(uuid, date, numeric, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.pagar_gasto_operacion(uuid, date, numeric, text, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.pagar_gasto_operacion IS
  'Registra un pago (total o parcial) de un gasto ya registrado: asiento 205 D / 102 H, fila en pagos_de_gasto, y pagado_en solo cuando el saldo llega a cero. Rechaza sobrepagos, borradores, cancelados y fechas anteriores al gasto.';

-- ---------------------------------------------------------------------------
-- 3. El gasto capturado YA PAGADO tambien deja su fila
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.registrar_gasto_operacion(p_gasto_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $cuerpo$
DECLARE
  v_g          record;
  v_asiento_id uuid;
  v_numero     text;
  v_iva_mxn    numeric(14,2);
  v_sub_mxn    numeric(14,2);
  v_cuenta_haber text;
  v_linea      integer := 0;
BEGIN
  -- Autorizacion explicita: la funcion es SECURITY DEFINER, asi que sin esto
  -- se saltaria las RLS de arriba.
  IF NOT public.puede_gestionar_gastos() THEN
    RAISE EXCEPTION 'No autorizado para registrar gastos de operacion.'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_g FROM public.gastos_operacion WHERE id = p_gasto_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El gasto % no existe.', p_gasto_id USING ERRCODE = 'P0002';
  END IF;

  IF v_g.estado = 'registrado' THEN
    -- Idempotente: registrar dos veces no crea dos asientos.
    RETURN v_g.asiento_id;
  END IF;
  IF v_g.estado = 'cancelado' THEN
    RAISE EXCEPTION 'El gasto % esta cancelado y no se puede registrar.', p_gasto_id;
  END IF;

  -- El IVA en pesos se deriva del TOTAL EN PESOS, no de `iva * tipo_cambio`.
  -- Como `total_mxn` es editable, multiplicar cada parte por su cuenta dejaria
  -- el asiento descuadrado en cuanto alguien lo ajustara al importe del banco.
  -- Repartiendo en proporcion, el asiento cuadra siempre.
  v_iva_mxn := CASE WHEN v_g.total > 0
                    THEN round(v_g.total_mxn * (v_g.iva / v_g.total), 2)
                    ELSE 0 END;
  v_sub_mxn := v_g.total_mxn - v_iva_mxn;

  -- Pagado sale del banco; pendiente es deuda con un acreedor.
  v_cuenta_haber := CASE WHEN v_g.pagado_en IS NOT NULL THEN '102' ELSE '205' END;

  v_numero := public.generate_entry_number(
                'egreso',
                extract(year  FROM v_g.fecha)::int,
                extract(month FROM v_g.fecha)::int);

  INSERT INTO public.accounting_entries (
    entry_number, entry_type, entry_date, period_year, period_month,
    description, source_type, source_id, is_posted, posted_at, created_by
  ) VALUES (
    v_numero, 'egreso', v_g.fecha,
    extract(year FROM v_g.fecha)::int, extract(month FROM v_g.fecha)::int,
    v_g.proveedor || ' — ' || v_g.descripcion,
    'gasto_operacion', v_g.id, true, now(), auth.uid()
  ) RETURNING id INTO v_asiento_id;

  v_linea := v_linea + 1;
  INSERT INTO public.accounting_entry_lines
    (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
  VALUES (v_asiento_id, v_linea, v_g.cuenta_contable,
          v_g.proveedor || ' — ' || v_g.descripcion, v_sub_mxn, 0, v_g.cfdi_uuid);

  IF v_iva_mxn > 0 THEN
    v_linea := v_linea + 1;
    INSERT INTO public.accounting_entry_lines
      (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
    VALUES (v_asiento_id, v_linea, '108',
            'IVA acreditable — ' || v_g.proveedor, v_iva_mxn, 0, v_g.cfdi_uuid);
  END IF;

  v_linea := v_linea + 1;
  INSERT INTO public.accounting_entry_lines
    (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
  VALUES (v_asiento_id, v_linea, v_cuenta_haber,
          CASE WHEN v_g.pagado_en IS NOT NULL
               THEN 'Pago a ' || v_g.proveedor
               ELSE 'Por pagar a ' || v_g.proveedor END,
          0, v_g.total_mxn, v_g.cfdi_uuid);

  UPDATE public.gastos_operacion
     SET estado = 'registrado', asiento_id = v_asiento_id, updated_at = now()
   WHERE id = p_gasto_id;

  -- Si se capturo YA PAGADO, el asiento de arriba abono directo a 102 y nunca
  -- hubo deuda que saldar. Aun asi se deja la fila en `pagos_de_gasto`,
  -- apuntando a ESTE MISMO asiento y sin crear un segundo: desde
  -- `20260911040000` la vista suma pagos para decidir caja contra pasivo, y un
  -- gasto pagado sin fila figuraria como no pagado. El modelo tiene que ser
  -- uniforme o el reporte miente.
  IF v_g.pagado_en IS NOT NULL THEN
    INSERT INTO public.pagos_de_gasto
      (gasto_id, fecha, monto_mxn, metodo_pago, referencia, asiento_id)
    VALUES
      (p_gasto_id, v_g.pagado_en, v_g.total_mxn, v_g.metodo_pago,
       v_g.referencia_pago, v_asiento_id);
  END IF;

  RETURN v_asiento_id;
END;
$cuerpo$;

-- ---------------------------------------------------------------------------
-- 3b. La vista: caja y pasivo salen de lo pagado
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.vista_movimientos_financieros
WITH (security_invoker = true) AS

-- 1. Cobros por pasarela.
--
--    El caso normal genera pasivo: el dinero entra pero es de la agencia hasta
--    que se reconoce la comision (bloque 8). La excepcion son los productos
--    propios de ToursRed, que no le deben nada a nadie.
SELECT
  pt.created_at                                   AS fecha,
  'cobro_' || coalesce(pt.charge_context,'otro')  AS categoria,
  'ingreso'                                       AS naturaleza,
  coalesce(pt.charge_context,'cobro')             AS descripcion,
  coalesce(b.booking_code, left(pt.id::text, 8))  AS referencia,
  a.name                                          AS entidad,
  coalesce(pt.payment_processor,'(sin procesador)') AS metodo,
  pt.amount                                       AS caja,
  CASE WHEN pt.charge_context IN ('membership') THEN 0 ELSE pt.amount END AS pasivo,
  CASE WHEN pt.charge_context IN ('membership') THEN pt.amount ELSE 0 END AS ingreso,
  0::numeric                                      AS traspaso,
  'payment_transactions'                          AS origen_tabla,
  pt.id                                           AS origen_id
FROM public.payment_transactions pt
LEFT JOIN public.bookings b ON b.id = pt.booking_id
LEFT JOIN public.agencies  a ON a.id = b.agency_id
WHERE pt.status = 'succeeded'

UNION ALL

-- 2. Comision del procesador. Sale del banco y es gasto.
--    OJO: subregistrada. Conekta y OpenPay reportan 0.00 y si cobran.
SELECT pt.created_at, 'comision_procesador', 'egreso',
       'Comision ' || coalesce(pt.payment_processor,'procesador'),
       left(pt.id::text, 8), NULL, coalesce(pt.payment_processor,'(sin procesador)'),
       -pt.processor_fee, 0, -pt.processor_fee, 0,
       'payment_transactions', pt.id
FROM public.payment_transactions pt
WHERE pt.status = 'succeeded' AND coalesce(pt.processor_fee,0) > 0

UNION ALL

-- 3. (libre) Las recargas ya no se leen de `openpay_wallet_topups`: las cubre
--     el bloque 11, que lee el monedero entero. Comprobado que son el mismo
--     dinero -- 3 filas y $51,600.00 en las dos -- asi que leer las dos seria
--     contarlo doble.

-- 4. Tarjetas de regalo vendidas. Pasivo hasta que se canjean o caducan.
SELECT gc.purchased_at, 'tarjeta_regalo', 'ingreso', 'Venta de tarjeta de regalo',
       gc.code, gc.purchaser_email, coalesce(gc.payment_provider,'(sin proveedor)'),
       gc.amount, gc.amount, 0, 0,
       'gift_cards', gc.id
FROM public.gift_cards gc
WHERE gc.payment_status = 'paid'

UNION ALL

-- 5. Servicios opcionales cobrados. Su INGRESO ya viene en commission_records
--    (bloque 8), asi que aqui solo entra la caja. Los pagados con puntos no
--    mueven caja.
SELECT coalesce(bos.paid_at, bos.created_at), 'servicio_opcional', 'ingreso',
       coalesce(bos.description,'Servicio opcional'),
       coalesce(b.booking_code, left(bos.id::text, 8)), a.name,
       coalesce(bos.payment_method,'(sin metodo)'),
       CASE WHEN bos.payment_method = 'points' THEN 0 ELSE bos.total_paid END,
       CASE WHEN bos.payment_method = 'points' THEN 0 ELSE bos.total_paid END,
       0,
       CASE WHEN bos.payment_method = 'points' THEN bos.total_paid ELSE 0 END,
       'booking_optional_services', bos.id
FROM public.booking_optional_services bos
LEFT JOIN public.bookings b ON b.id = bos.booking_id
LEFT JOIN public.agencies  a ON a.id = b.agency_id
WHERE bos.paid_at IS NOT NULL

UNION ALL

-- 6. Suplementos. Cero filas al 10-sep-2026; se incluye para que el dia que se
--    usen aparezcan solos en vez de faltar en silencio.
SELECT bs.created_at, 'suplemento', 'ingreso', 'Suplemento',
       coalesce(b.booking_code, left(bs.id::text, 8)), a.name, '(sin metodo)',
       bs.total_paid, bs.total_paid, 0, 0,
       'booking_supplements', bs.id
FROM public.booking_supplements bs
LEFT JOIN public.bookings b ON b.id = bs.booking_id
LEFT JOIN public.agencies  a ON a.id = b.agency_id
WHERE coalesce(bs.total_paid,0) > 0

UNION ALL

-- 7. Tours destacados. Servicio de promocion que se le cobra a la agencia:
--    ingreso 100% de ToursRed, sin pasivo, porque no hay nada que liberar.
SELECT fts.payment_confirmed_at, 'tour_destacado', 'ingreso',
       'Promocion de tour destacado', left(fts.id::text, 8), a.name,
       coalesce(fts.payment_provider,'(sin proveedor)'),
       fts.total_amount, 0, fts.total_amount, 0,
       'featured_tour_slots', fts.id
FROM public.featured_tour_slots fts
LEFT JOIN public.agencies a ON a.id = fts.agency_id
WHERE fts.payment_confirmed_at IS NOT NULL

UNION ALL

-- 8. Reconocimiento del ingreso. Aqui es donde el dinero deja de ser de la
--    agencia y pasa a ser de ToursRed.
--
--    EL DOBLE FILTRO NO ES OPCIONAL -- ver la cabecera. Se exige que la
--    reserva este viva Y que el registro no este anulado, porque al
--    10-sep-2026 hay 4 reservas canceladas cuyo registro sigue en `processed`.
SELECT coalesce(cr.processed_at, cr.created_at), 'reconocimiento_ingreso', 'ingreso',
       'Comision y cargo por servicio',
       coalesce(b.booking_code, left(cr.id::text, 8)), a.name, NULL,
       0, -cr.platform_total_revenue, cr.platform_total_revenue, 0,
       'commission_records', cr.id
FROM public.commission_records cr
JOIN public.bookings b ON b.id = cr.booking_id
LEFT JOIN public.agencies a ON a.id = cr.agency_id
WHERE b.status NOT IN ('cancelled','cancellation_processing')
  AND coalesce(cr.status,'') <> 'voided'

UNION ALL

-- 9. Comision que paga la aseguradora. Ingreso puro, sin pasivo.
SELECT icr.receipt_date, 'comision_aseguradora', 'ingreso',
       'Comision de ' || coalesce(icr.provider_name,'aseguradora'),
       coalesce(icr.invoice_reference, left(icr.id::text, 8)), icr.provider_name, NULL,
       icr.amount, 0, icr.amount, 0,
       'insurance_commission_receipts', icr.id
FROM public.insurance_commission_receipts icr

UNION ALL

-- 10. Liberacion a la agencia. Salida de caja real y baja del pasivo.
SELECT ap.payment_date, 'pago_agencia', 'egreso', 'Liberacion de fondos',
       coalesce(ap.payout_code, left(ap.id::text, 8)), a.name,
       coalesce(ap.payment_method,'(sin metodo)'),
       -ap.amount, -ap.amount, 0, 0,
       'agency_payouts', ap.id
FROM public.agency_payouts ap
LEFT JOIN public.agencies a ON a.id = ap.agency_id
WHERE ap.status = 'completed'

UNION ALL

-- 11. EL MONEDERO ENTERO, con sus ocho tipos.
--
--     Se lee de `toursred_cash_transactions` y no de las tablas sueltas de
--     cada movimiento, por la misma razon en los dos sentidos:
--
--     * `openpay_wallet_topups` solo cubre el riel de OpenPay. El enum del
--       monedero tiene DOS tipos de recarga (`topup_spei` y `topup_codi`), y
--       ocho tipos en total. Leer la tabla suelta dejaba fuera cinco.
--     * Las tablas de cancelacion dan $17,532.54 de reembolso; el monedero
--       registra $23,096.54. Hay 9 reembolsos que no aparecen en
--       `refund_amount_to_traveler`.
--
--     Comprobado que `topup_spei` en el monedero y `openpay_wallet_topups`
--     completadas son EL MISMO dinero: 3 filas y $51,600.00 en las dos. Leer
--     las dos lo contaria doble, y por eso el bloque 3 quedo vacio.
--
--     El mapeo por tipo, que es donde esta toda la sustancia:
--
--       topup_spei / topup_codi  dinero nuevo que entra al banco y se le debe
--                                al viajero -> caja + y pasivo +
--       debit                    paga una reserva con su saldo. NO es caja
--                                nueva: ya entro en la recarga. Solo cambia de
--                                acreedor -> traspaso
--       refund                   se le devuelve al monedero, no a la tarjeta.
--                                Tampoco sale del banco -> traspaso
--       gift_card                canje. El pasivo pasa de "tarjetas por
--                                canjear" (218-12) a "monedero" (218-11). Ni
--                                caja ni ingreso -> traspaso
--       promotion / credit /     saldo que regala o ajusta ToursRed. No entra
--       adjustment               dinero pero se crea una deuda, y eso cuesta
--                                -> pasivo + e ingreso -
SELECT tct.created_at,
       'monedero_' || tct.type::text, 
       CASE WHEN tct.amount < 0 THEN 'egreso' ELSE 'ingreso' END,
       'Monedero: ' || tct.type::text
         || coalesce(' (' || tct.reference_type || ')', ''),
       coalesce(b.booking_code, left(tct.id::text, 8)),
       nullif(trim(coalesce(u.first_name,'') || ' ' || coalesce(u.last_name,'')), ''),
       'toursred_cash',
       CASE WHEN tct.type::text IN ('topup_spei','topup_codi') THEN tct.amount ELSE 0 END,
       CASE WHEN tct.type::text IN ('topup_spei','topup_codi')            THEN tct.amount
            WHEN tct.type::text IN ('promotion','credit','adjustment')    THEN tct.amount
            ELSE 0 END,
       CASE WHEN tct.type::text IN ('promotion','credit','adjustment')    THEN -tct.amount
            ELSE 0 END,
       CASE WHEN tct.type::text IN ('debit','refund','gift_card')         THEN abs(tct.amount)
            ELSE 0 END,
       'toursred_cash_transactions', tct.id
FROM public.toursred_cash_transactions tct
LEFT JOIN public.users u ON u.id = tct.user_id
LEFT JOIN public.bookings b ON b.id = tct.reference_id

UNION ALL

-- 12. Reembolso AL METODO DE PAGO ORIGINAL. Este SI sale del banco.
--
--     Lo hace un admin desde el panel (`process-payment-refund`) para los casos
--     en que devolver al monedero no es opcion: una disputa ante PROFECO que
--     obligue a regresar el dinero a la misma tarjeta, por ejemplo. Son pocos
--     —la tabla esta vacia al 10-sep-2026— pero cuando ocurren es dinero que
--     de verdad se va, y confundirlos con un abono al monedero seria un error
--     grande sobre un importe grande.
--
--     `succeeded` es el estado terminal que ponen los webhooks de Stripe y
--     PayPal al confirmar la devolucion; `pending`, `processing` y `failed` no
--     han movido el banco todavia.
SELECT coalesce(pr.confirmed_at, pr.processed_at, pr.created_at),
       'reembolso_metodo_original', 'egreso',
       'Reembolso al metodo de pago original (' || coalesce(pr.refund_method,'sin metodo') || ')',
       coalesce(b.booking_code, left(pr.id::text, 8)), a.name,
       coalesce(pr.payment_processor,'(sin procesador)'),
       -pr.requested_amount, -pr.requested_amount, 0, 0,
       'payment_refunds', pr.id
FROM public.payment_refunds pr
LEFT JOIN public.bookings b ON b.id = pr.booking_id
LEFT JOIN public.agencies  a ON a.id = b.agency_id
WHERE pr.status = 'succeeded'

UNION ALL

-- 13. Lo que el procesador cobra POR reembolsar. Dinero nuevo que sale.
--
--     Se usa `processor_refund_fee` y NO `processor_fee_lost`: el segundo es la
--     comision del cobro original, que el procesador se queda al devolver. Esa
--     ya se conto como gasto en el bloque 2 cuando entro el dinero; volver a
--     restarla aqui seria contarla dos veces.
SELECT coalesce(pr.confirmed_at, pr.processed_at, pr.created_at),
       'comision_por_reembolso', 'egreso',
       'Comision de ' || coalesce(pr.payment_processor,'procesador') || ' por reembolsar',
       coalesce(b.booking_code, left(pr.id::text, 8)), a.name,
       coalesce(pr.payment_processor,'(sin procesador)'),
       -pr.processor_refund_fee, 0, -pr.processor_refund_fee, 0,
       'payment_refunds', pr.id
FROM public.payment_refunds pr
LEFT JOIN public.bookings b ON b.id = pr.booking_id
LEFT JOIN public.agencies  a ON a.id = b.agency_id
WHERE pr.status = 'succeeded' AND coalesce(pr.processor_refund_fee,0) > 0

UNION ALL

-- 14. (libre) El pago con monedero lo cubre el bloque 11, con el tipo `debit`.

-- 15. Comision al ejecutivo de cuenta. Es gasto en cuanto se devenga, sale del
--     banco cuando se paga, y mientras tanto es una DEUDA. Las tres cosas.
SELECT coalesce(ec.paid_at, ec.created_at), 'comision_ejecutivo', 'egreso',
       'Comision de ejecutivo (' || coalesce(ec.commission_type,'sin tipo') || ')',
       left(ec.id::text, 8), a.name, coalesce(ec.payment_reference,'(sin referencia)'),
       CASE WHEN ec.status = 'paid' THEN -ec.amount ELSE 0 END,
       -- Lo devengado y NO pagado es dinero que ToursRed debe. Sin esta linea
       -- la categoria descuadraba $736.25 contra la ecuacion contable.
       CASE WHEN ec.status = 'paid' THEN 0 ELSE ec.amount END,
       -ec.amount, 0,
       'executive_commissions', ec.id
FROM public.executive_commissions ec
LEFT JOIN public.agencies a ON a.id = ec.agency_id

UNION ALL

-- 16. Puntos otorgados. No mueven caja pero son un pasivo real y su costo es
--     ingreso que no se va a percibir. 100 puntos = 1 peso.
SELECT tpt.created_at, 'puntos_otorgados', 'egreso',
       'Puntos otorgados (' || coalesce(tpt.reference_type,'sin origen') || ')',
       left(tpt.id::text, 8),
       nullif(trim(coalesce(u.first_name,'') || ' ' || coalesce(u.last_name,'')), ''),
       'puntos',
       0, tpt.amount / 100.0, -tpt.amount / 100.0, 0,
       'toursred_points_transactions', tpt.id
FROM public.toursred_points_transactions tpt
LEFT JOIN public.users u ON u.id = tpt.user_id
WHERE tpt.type::text = 'earned'

UNION ALL

-- 17. Liquidacion a la aseguradora. Cero filas hoy; se incluye por lo mismo
--     que el bloque 6.
SELECT ist.payment_date, 'liquidacion_aseguradora', 'egreso',
       'Liquidacion a ' || coalesce(ist.provider_name,'aseguradora'),
       coalesce(ist.reference, left(ist.id::text, 8)), ist.provider_name, NULL,
       -ist.amount, -ist.amount, 0, 0,
       'insurance_settlements', ist.id
FROM public.insurance_settlements ist

UNION ALL

-- 18. Contracargos por disputa. Cero filas hoy.
SELECT pd.created_at, 'contracargo', 'egreso', 'Contracargo por disputa',
       left(pd.id::text, 8), NULL, NULL,
       -pd.amount, 0, -pd.amount, 0,
       'payment_disputes', pd.id
FROM public.payment_disputes pd

UNION ALL

-- 19. Gastos de operacion capturados a mano o desde un CFDI. Solo los
--     registrados: un borrador todavia no tiene asiento y no es un hecho.
SELECT g.fecha::timestamptz, 'gasto_operacion', 'egreso',
       g.proveedor || ' — ' || g.descripcion,
       coalesce(g.cfdi_uuid, left(g.id::text, 8)), g.proveedor,
       coalesce(g.metodo_pago, '(sin metodo)'),
       -- Caja y pasivo salen de LO PAGADO, no de un si/no. Antes era
       -- `pagado_en IS NOT NULL`, que no sabe representar un pago parcial: un
       -- gasto de 232 con 100 abonados figuraba como deuda entera o como
       -- salida entera, nunca como lo que era.
       --
       -- El invariante se sostiene igual:
       --   caja(-pagado) = pasivo(total - pagado) + ingreso(-total)
       -- porque -pagado = (total - pagado) + (-total). Cuadra con 0, con el
       -- total, y con cualquier parcial.
       -coalesce(p.pagado, 0),
       g.total_mxn - coalesce(p.pagado, 0),
       -g.total_mxn, 0,
       'gastos_operacion', g.id
FROM public.gastos_operacion g
LEFT JOIN LATERAL (
  SELECT sum(x.monto_mxn) AS pagado
  FROM public.pagos_de_gasto x
  WHERE x.gasto_id = g.id
) p ON true
WHERE g.estado = 'registrado';

-- ---------------------------------------------------------------------------
-- 4. Backfill: los gastos que ya estaban registrados Y pagados
-- ---------------------------------------------------------------------------
-- Se registraron antes de que existiera `pagos_de_gasto`, asi que no tienen
-- fila. Sin esto, la vista nueva los veria como no pagados y les inventaria una
-- deuda que ya no existe. Al 11-sep-2026 son CERO —el unico gasto capturado
-- quedo por pagar— pero se escribe igual: lo que se corre una vez tiene que
-- poder correrse sobre cualquier base.
INSERT INTO public.pagos_de_gasto
  (gasto_id, fecha, monto_mxn, metodo_pago, referencia, asiento_id)
SELECT g.id, g.pagado_en, g.total_mxn, g.metodo_pago, g.referencia_pago, g.asiento_id
FROM public.gastos_operacion g
WHERE g.estado = 'registrado'
  AND g.pagado_en IS NOT NULL
  AND g.asiento_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.pagos_de_gasto x WHERE x.gasto_id = g.id);

-- ---------------------------------------------------------------------------
-- 5. Aserciones
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_sin_fila integer;
  v_sobre    integer;
BEGIN
  -- Ningun gasto pagado puede quedar sin su fila de pago.
  SELECT count(*) INTO v_sin_fila
  FROM public.gastos_operacion g
  WHERE g.estado = 'registrado' AND g.pagado_en IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.pagos_de_gasto x WHERE x.gasto_id = g.id);
  IF v_sin_fila > 0 THEN
    RAISE EXCEPTION 'Quedaron % gastos pagados sin fila en pagos_de_gasto', v_sin_fila;
  END IF;

  -- Ni pagarse de mas.
  SELECT count(*) INTO v_sobre
  FROM public.gastos_operacion g
  JOIN (SELECT gasto_id, sum(monto_mxn) AS pagado
        FROM public.pagos_de_gasto GROUP BY 1) p ON p.gasto_id = g.id
  WHERE round(p.pagado, 2) > round(g.total_mxn, 2) + 0.01;
  IF v_sobre > 0 THEN
    RAISE EXCEPTION 'Hay % gastos con pagos por encima de su total', v_sobre;
  END IF;

  -- Las cuentas del asiento de pago tienen que existir.
  IF NOT EXISTS (SELECT 1 FROM public.chart_of_accounts WHERE code='205' AND is_active)
     OR NOT EXISTS (SELECT 1 FROM public.chart_of_accounts WHERE code='102' AND is_active) THEN
    RAISE EXCEPTION 'Faltan las cuentas 205 o 102 en el catalogo';
  END IF;

  RAISE NOTICE 'OK: pagos_de_gasto consistente y cuentas 205/102 activas';
END
$$;
