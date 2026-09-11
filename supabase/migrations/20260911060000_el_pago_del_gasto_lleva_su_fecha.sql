-- ============================================================================
-- El pago de un gasto es un movimiento CON SU PROPIA FECHA
-- ============================================================================
--
-- LO QUE ESTABA MAL
--
-- El bloque 19 emitia UNA fila por gasto, fechada el dia del GASTO, y ahi
-- metia el devengo y los pagos juntos:
--
--     SELECT g.fecha::timestamptz, ...
--            -coalesce(p.pagado, 0),           -- caja: lo pagado
--            g.total_mxn - coalesce(p.pagado, 0),
--            -g.total_mxn, 0,
--
-- El gasto de TikTok se devengo el 1-jul y se pago el 11-sep. El reporte
-- maestro contaba esos 232 como salida de banco del **1 de julio**. Si cierras
-- julio te sobran 232 que no salieron; si cierras septiembre te faltan. Con
-- parcialidades es peor: 100 en julio y 132 en septiembre aterrizaban los dos
-- en julio.
--
-- POR QUE PASO LAS PRUEBAS
--
-- El comentario de aquel bloque presumia del invariante
-- `caja = pasivo + ingreso`, y es cierto: -pagado = (total - pagado) + (-total)
-- cuadra siempre. Las pruebas verificaban que los IMPORTES sumaran. Ninguna
-- verificaba que cayeran en la FECHA correcta. El invariante es ciego al
-- tiempo: una fila puede cuadrar perfecto y estar en el mes equivocado.
--
-- ----------------------------------------------------------------------------
-- EL MODELO NUEVO: UN HECHO, UNA FILA, SU FECHA
-- ----------------------------------------------------------------------------
--
-- El gasto deja de ser una fila y pasa a ser los movimientos que de verdad es:
--
--   19a. DEVENGO, el dia del gasto: nace la deuda, nace el costo, no se mueve
--        el banco.        caja 0 / pasivo +total / ingreso -total
--
--   19b. CADA PAGO, el dia del pago: sale el banco, baja la deuda, el costo ya
--        estaba reconocido. caja -monto / pasivo -monto / ingreso 0
--
-- Los totales no cambian y el invariante se sostiene FILA POR FILA, no solo en
-- la suma. Lo que cambia es que cada peso cae en el mes en que se movio, que es
-- justo lo que ya dice el libro: tres polizas con tres fechas distintas.
--
-- ----------------------------------------------------------------------------
-- EL CAMINO «CAPTURADO YA PAGADO» NO SE PARTE
-- ----------------------------------------------------------------------------
--
-- Es la parte que se puede equivocar facil. Cuando el gasto se captura con
-- `pagado_en` lleno, `registrar_gasto_operacion` abona directo a `102` y NUNCA
-- toca `205`: no hubo deuda intermedia, y su fila de pago apunta al MISMO
-- asiento del gasto (asi lo dejo `20260911040000`). Si ese caso se partiera en
-- devengo + pago, la vista inventaria un pasivo que el libro jamas registro.
--
-- Por eso 19a mira si existe un pago que comparta asiento con el gasto: si lo
-- hay, esa fila ya es la salida de banco (caja -total / pasivo 0), y 19b se
-- salta ese pago. La regla es exactamente la del libro —
-- `CASE WHEN pagado_en IS NOT NULL THEN '102' ELSE '205' END`— leida desde el
-- lado de los datos.
--
-- ----------------------------------------------------------------------------
-- LO QUE VAS A VER DISTINTO
-- ----------------------------------------------------------------------------
--
-- Un gasto con dos pagos pasa de 1 a 3 renglones en el reporte maestro, con la
-- categoria nueva `pago_de_gasto`. Es correcto: son tres hechos distintos, en
-- tres fechas. El conteo de movimientos sube; los totales no.
-- ============================================================================

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

-- 19a. Gastos de operacion: EL DEVENGO, el dia del gasto. Solo los
--      registrados: un borrador todavia no tiene asiento y no es un hecho.
--
--      El CASE separa los dos caminos del libro. Si existe un pago que comparta
--      asiento con el gasto, el gasto se capturo YA PAGADO: su asiento abono
--      directo a `102` y esta fila ES la salida de banco. Si no, el asiento
--      abono a `205` y esta fila es solo la deuda naciendo.
SELECT g.fecha::timestamptz, 'gasto_operacion', 'egreso',
       g.proveedor || ' — ' || g.descripcion,
       coalesce(g.cfdi_uuid, left(g.id::text, 8)), g.proveedor,
       CASE WHEN pc.al_capturar THEN coalesce(g.metodo_pago, '(sin metodo)')
            ELSE '(por pagar)' END,
       CASE WHEN pc.al_capturar THEN -g.total_mxn ELSE 0 END,
       CASE WHEN pc.al_capturar THEN 0 ELSE g.total_mxn END,
       -g.total_mxn, 0,
       'gastos_operacion', g.id
FROM public.gastos_operacion g
LEFT JOIN LATERAL (
  SELECT true AS al_capturar
  WHERE g.asiento_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.pagos_de_gasto x
                WHERE x.gasto_id = g.id AND x.asiento_id = g.asiento_id)
) pc ON true
WHERE g.estado = 'registrado'

UNION ALL

-- 19b. Gastos de operacion: CADA PAGO, el dia del pago. Sale el banco y baja la
--      deuda; el costo y el IVA ya se reconocieron en 19a.
--
--      Se excluyen los pagos que comparten asiento con el gasto: esos son el
--      camino «capturado ya pagado», que 19a ya reporto entero. Contarlos aqui
--      duplicaria la salida de banco.
SELECT p.fecha::timestamptz, 'pago_de_gasto', 'egreso',
       'Pago a ' || g.proveedor || ' — ' || g.descripcion,
       coalesce(p.referencia, left(p.id::text, 8)), g.proveedor,
       coalesce(p.metodo_pago, '(sin metodo)'),
       -p.monto_mxn, -p.monto_mxn, 0, 0,
       'pagos_de_gasto', p.id
FROM public.pagos_de_gasto p
JOIN public.gastos_operacion g ON g.id = p.gasto_id
WHERE g.estado = 'registrado'
  AND (g.asiento_id IS NULL OR p.asiento_id IS DISTINCT FROM g.asiento_id);

COMMENT ON VIEW public.vista_movimientos_financieros IS
  'Todo movimiento financiero de ToursRed en una sola forma: caja, pasivo, ingreso y traspaso, con el invariante caja = pasivo + ingreso fila por fila (traspaso queda fuera: cambia de dueno el dinero sin moverlo del banco). Cada hecho lleva SU PROPIA fecha: un gasto devengado en julio y pagado en septiembre son dos filas, no una.';
