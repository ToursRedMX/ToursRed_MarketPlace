-- `vista_movimientos_financieros`: el log financiero que el reporte maestro
-- necesita y hoy no tiene.
--
-- ============================================================================
-- POR QUE EXISTE
-- ============================================================================
--
-- `/admin/reporte-maestro` arma sus filas en el front, con 13 bloques que
-- consultan 13 tablas a mano. Eso permitio tres errores que no se ven al leer
-- el codigo:
--
--   * Lee `bookings.platform_revenue` como si fuera el ingreso de la
--     plataforma. No lo es: solo trae cargos por servicio, sin la comision.
--   * Lee `cancellation_penalty_records`, que tiene CERO filas, mientras los
--     reembolsos de verdad viven en `booking_cancellations` y
--     `booking_partial_cancellations`.
--   * Nunca toca `payment_transactions`, que es donde esta el dinero cobrado.
--
-- Medido el 10-sep-2026: el reporte mostraba $335.00 en una ventana donde
-- entraron $10,000.00.
--
-- ============================================================================
-- EL MODELO: TRES CAPAS
-- ============================================================================
--
-- La correccion de fondo es de Axel, y no es un detalle del monedero: es la
-- estructura de casi todo el dinero que toca ToursRed.
--
--   CAJA     ¿entro o salio dinero del banco?
--   PASIVO   ¿de quien es ese dinero?
--   INGRESO  ¿cuanto se gano de verdad?
--
-- Con un anticipo de $10,000: +$10,000 de caja, +$8,500 que se le deben a la
-- agencia, $1,500 de ingreso. LAS TRES SON CIERTAS A LA VEZ. Un reporte que
-- suma solo la primera dice que ToursRed facturo $10,000; uno que suma solo la
-- tercera dice $1,500. Ninguno esta bien solo.
--
-- El catalogo de cuentas ya lo modela (`218-11 ToursRed Cash — Monedero de
-- Clientes`, `208 Anticipos de clientes`), asi que el criterio no se inventa
-- aqui.
--
-- Hay una cuarta columna, `traspaso`, para el dinero que cambia de dueno sin
-- mover ninguna de las tres: pagar una reserva con el monedero, o un reembolso
-- que se acredita al monedero. Sin ella esos movimientos serian filas de puros
-- ceros —invisibles— y con ella se ven sin contaminar los totales.
--
-- ============================================================================
-- LAS DOS TRAMPAS QUE ESTA VISTA CIERRA POR CONSTRUCCION
-- ============================================================================
--
-- 1. CONTAR DOS VECES EL MONEDERO. La recarga es caja nueva; pagar una reserva
--    con ese saldo NO lo es. Verificado: hay $51,600 de recargas y $11,861.16
--    de reservas pagadas con monedero. Sumar las dos infla la caja en esa
--    cantidad. Aqui el pago con monedero va como `traspaso`, no como caja.
--
-- 2. CONTAR EL INGRESO DE RESERVAS CANCELADAS. `commission_records` tiene el
--    estado `voided`, pero `voided` marca la fila y NO TOCA EL IMPORTE:
--    `platform_total_revenue` conserva su valor. Un `SUM` sin filtrar da
--    $47,547.47 cuando lo real son $31,104.43 — inflado 53%.
--
--    Y no basta con filtrar por `cr.status`: de las 8 reservas canceladas al
--    10-sep-2026, solo 4 tienen su registro en `voided`. Las otras 4 siguen en
--    `processed`. Por eso el filtro mira LAS DOS COSAS, el estado de la reserva
--    y el del registro de comision.
--
--    Esa es la razon principal para que esto viva en la base y no en el front:
--    hoy cada consulta tiene que acordarse de filtrar, y no acordarse no da
--    error — da un numero mas alto.
--
-- ============================================================================
-- LO QUE ESTA VISTA NO PUEDE HACER
-- ============================================================================
--
--   * GASTOS DE OPERACION (Telcel, Anthropic, renta, luz). El catalogo de
--     cuentas los tiene (`601.01`, `601.02`, `602`, `603`) pero NO EXISTE
--     TABLA donde capturarlos, ni siquiera a mano. Van a faltar hasta que se
--     construya esa captura, y el reporte tiene que decirlo en pantalla en vez
--     de dar a entender que estan en cero.
--
--   * DESGLOSAR UNA CANCELACION entre lo que se devolvio y lo que se retuvo:
--     `booking_cancellations.amount_to_platform` y `amount_to_agency` estan en
--     0.00 en las 7 filas. El movimiento se ve; el reparto no.
--
--   * COMISIONES DE MAYORISTA y TOURS A LA MEDIDA. Tienen cuenta contable
--     (`407`, `406`, `408`) pero tampoco tabla.

CREATE OR REPLACE VIEW public.vista_movimientos_financieros
WITH (security_invoker = true) AS

-- 1. Cobros por pasarela. Todo lo que entra empieza siendo de alguien mas.
SELECT
  pt.created_at                                   AS fecha,
  'cobro_' || coalesce(pt.charge_context,'otro')  AS categoria,
  'ingreso'                                       AS naturaleza,
  coalesce(pt.charge_context,'cobro')             AS descripcion,
  coalesce(b.booking_code, left(pt.id::text, 8))  AS referencia,
  a.name                                          AS entidad,
  coalesce(pt.payment_processor,'(sin procesador)') AS metodo,
  pt.amount                                       AS caja,
  pt.amount                                       AS pasivo,
  0::numeric                                      AS ingreso,
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

-- 3. Recargas de monedero. Caja real; ingreso cero: es dinero del viajero.
SELECT t.created_at, 'recarga_monedero', 'ingreso', 'Recarga de ToursRed Cash',
       left(t.id::text, 8),
       nullif(trim(coalesce(u.first_name,'') || ' ' || coalesce(u.last_name,'')), ''),
       'openpay', t.amount, t.amount, 0, 0,
       'openpay_wallet_topups', t.id
FROM public.openpay_wallet_topups t
LEFT JOIN public.users u ON u.id = t.user_id
WHERE t.status = 'completed'

UNION ALL

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

-- 11. Reembolsos. NO SALEN DEL BANCO: se acreditan al monedero del viajero.
--     Es el pasivo cambiando de acreedor, y por eso van como traspaso.
--
--     SE LEEN DEL MONEDERO Y NO DE LAS TABLAS DE CANCELACION, a proposito.
--     Sumar `booking_cancellations` + `booking_partial_cancellations` da
--     $17,532.54, pero el monedero registra $23,096.54: hay 9 reembolsos con
--     `reference_type = 'booking_cancellation'` que no aparecen en
--     `refund_amount_to_traveler`. Verificado ademas que `payment_refunds`
--     tiene CERO filas, o sea que no existe la via "de vuelta a la tarjeta":
--     todo reembolso pasa por aqui. Una sola fuente, y es la completa.
--
--     Lo que esta fuente NO da es el reparto entre lo devuelto y lo retenido
--     como penalizacion: `booking_cancellations.amount_to_platform` y
--     `amount_to_agency` estan en 0.00 en las 7 filas, asi que ese desglose
--     hoy no existe en ningun lado.
SELECT tct.created_at, 'reembolso_' || coalesce(tct.reference_type,'sin_origen'), 'egreso',
       'Reembolso al monedero (' || coalesce(tct.reference_type,'sin origen') || ')',
       coalesce(b.booking_code, left(tct.id::text, 8)),
       nullif(trim(coalesce(u.first_name,'') || ' ' || coalesce(u.last_name,'')), ''),
       'toursred_cash',
       0, 0, 0, tct.amount,
       'toursred_cash_transactions', tct.id
FROM public.toursred_cash_transactions tct
LEFT JOIN public.users u ON u.id = tct.user_id
LEFT JOIN public.bookings b ON b.id = tct.reference_id
WHERE tct.type::text = 'refund'

UNION ALL

-- 12. Reserva pagada con el monedero. LA FILA QUE EVITA CONTAR DOBLE.
--     Caja cero: ese dinero ya entro cuando se recargo. Solo cambia de
--     acreedor, del viajero a la agencia.
SELECT tct.created_at, 'pago_con_monedero', 'ingreso',
       'Reserva pagada con ToursRed Cash', left(tct.id::text, 8),
       nullif(trim(coalesce(u.first_name,'') || ' ' || coalesce(u.last_name,'')), ''),
       'toursred_cash',
       0, 0, 0, abs(tct.amount),
       'toursred_cash_transactions', tct.id
FROM public.toursred_cash_transactions tct
LEFT JOIN public.users u ON u.id = tct.user_id
WHERE tct.type::text = 'debit'

UNION ALL

-- 13. Comision al ejecutivo de cuenta. Es gasto en cuanto se devenga; solo
--     sale del banco cuando se paga.
SELECT coalesce(ec.paid_at, ec.created_at), 'comision_ejecutivo', 'egreso',
       'Comision de ejecutivo (' || coalesce(ec.commission_type,'sin tipo') || ')',
       left(ec.id::text, 8), a.name, coalesce(ec.payment_reference,'(sin referencia)'),
       CASE WHEN ec.status = 'paid' THEN -ec.amount ELSE 0 END,
       0, -ec.amount, 0,
       'executive_commissions', ec.id
FROM public.executive_commissions ec
LEFT JOIN public.agencies a ON a.id = ec.agency_id

UNION ALL

-- 14. Puntos otorgados. No mueven caja pero son un pasivo real y su costo es
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

-- 15. Liquidacion a la aseguradora. Cero filas hoy; se incluye por lo mismo
--     que el bloque 6.
SELECT ist.payment_date, 'liquidacion_aseguradora', 'egreso',
       'Liquidacion a ' || coalesce(ist.provider_name,'aseguradora'),
       coalesce(ist.reference, left(ist.id::text, 8)), ist.provider_name, NULL,
       -ist.amount, -ist.amount, 0, 0,
       'insurance_settlements', ist.id
FROM public.insurance_settlements ist

UNION ALL

-- 16. Contracargos por disputa. Cero filas hoy.
SELECT pd.created_at, 'contracargo', 'egreso', 'Contracargo por disputa',
       left(pd.id::text, 8), NULL, NULL,
       -pd.amount, 0, -pd.amount, 0,
       'payment_disputes', pd.id
FROM public.payment_disputes pd;


COMMENT ON VIEW public.vista_movimientos_financieros IS
  'Log financiero de la plataforma en tres capas: caja (dinero del banco), '
  'pasivo (de quien es) e ingreso (lo que se gano), mas traspaso para el dinero '
  'que cambia de dueno sin mover las tres. Insumo de /admin/reporte-maestro. '
  'NO incluye gastos de operacion: no existe tabla donde capturarlos.';

-- `security_invoker = true` para que la vista NO sea un rodeo alrededor de las
-- RLS de las tablas de abajo. Sin eso, la vista correria con los permisos de
-- quien la creo y cualquiera con SELECT veria el dinero de todos.
REVOKE ALL ON public.vista_movimientos_financieros FROM PUBLIC;
REVOKE ALL ON public.vista_movimientos_financieros FROM anon;
GRANT SELECT ON public.vista_movimientos_financieros TO authenticated, service_role;
