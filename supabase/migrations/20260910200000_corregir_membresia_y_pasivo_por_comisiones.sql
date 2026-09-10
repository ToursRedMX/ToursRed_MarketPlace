-- Dos errores de modelado en `vista_movimientos_financieros`, los dos
-- encontrados por Axel al abrir el reporte por primera vez.
--
-- NOTA SOBRE LA NUMERACION: este archivo nacio como `20260910090000` y se
-- renumero a `...200000`. Cuando se fue a aplicar, la base ya tenia
-- `20260910190000_bitacora_registra_el_origen_de_la_peticion` (de Codex, en
-- paralelo), y el CLI se niega a insertar una migracion con version anterior
-- a la ultima aplicada. La salida que ofrece el CLI en ese caso es
-- `--include-all`, que en este repo NO SE USA: aplicaria a ciegas todo lo
-- pendiente sin mirar el orden. Renumerar es lo correcto y aqui era seguro
-- porque las dos migraciones no se tocan -- una es la vista financiera, la
-- otra la bitacora de auditoria -- y esta nunca se habia aplicado, asi que no
-- hay entrada en el ledger que corregir.
--
-- ============================================================================
-- 1. LA MEMBRESIA NO ES UN PASIVO
-- ============================================================================
--
--   "por ejemplo la membresia porque esta marcada como pasivo? si esa si es
--    100% ingreso de toursred"
--
-- Tiene razon. El bloque 1 de la vista mete TODOS los cobros de
-- `payment_transactions` con la misma regla —caja + y pasivo +— porque el caso
-- normal es un anticipo de reserva, donde el dinero que entra es de la agencia
-- hasta que se reconoce la comision.
--
-- Pero una membresia es un producto DE TOURSRED. No hay agencia a la que
-- liberarle nada, asi que no genera pasivo: entra al banco y es ingreso desde
-- el primer momento. Ademas nunca se reconocia, porque el reconocimiento sale
-- de `commission_records`, que solo cubre reservas. O sea que los $860.46 de
-- la unica membresia vendida quedaban como una deuda que no existe, y como
-- ingreso cero.
--
-- La correccion usa una lista EXPLICITA de cobros que son producto propio, y
-- no un `<> 'booking_deposit'`, para que un `charge_context` nuevo caiga por
-- omision en el caso conservador (genera pasivo) y no se cuele como ingreso
-- sin que nadie lo decida.
--
-- ============================================================================
-- 2. LO QUE SE LE DEBE A LOS EJECUTIVOS ERA UN GASTO SIN DEUDA
-- ============================================================================
--
-- Este salio de comprobar la ecuacion contable por categoria:
--
--     movimiento de activo = movimiento de pasivo + ingreso reconocido
--
-- Una sola categoria no cuadraba: `comision_ejecutivo`, por $736.25.
--
-- El motivo: la comision se reconoce como gasto en cuanto se devenga, pero
-- solo salia del banco cuando se pagaba. De las tres comisiones, una esta
-- pagada ($100) y dos siguen pendientes ($100 + $636.25). Esas dos son gasto
-- YA, y ademas son dinero que ToursRed DEBE. Faltaba el pasivo.
--
-- Con la correccion: pagada -> caja -100, pasivo 0, ingreso -100. Pendiente ->
-- caja 0, pasivo +636.25, ingreso -636.25. Las dos cuadran.
--
-- ============================================================================
-- POR QUE LA ECUACION IMPORTA MAS QUE ESTAS DOS CORRECCIONES
-- ============================================================================
--
-- `activo = pasivo + ingreso` es un invariante que se puede comprobar solo, y
-- desde hoy lo comprueba la prueba en cada corrida, categoria por categoria.
-- Cualquier bloque futuro que reparta mal un movimiento lo rompe y se cae.
--
-- Con una salvedad honesta: el invariante NO habria cazado lo de la membresia.
-- Ese caso cuadraba igual ($860.46 de activo contra $860.46 de pasivo); estaba
-- bien balanceado y mal clasificado. Para eso hace falta una prueba que diga
-- que una membresia es ingreso, y tambien se agrega. El invariante cubre los
-- descuadres; la clasificacion hay que afirmarla concepto por concepto.

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
FROM public.payment_disputes pd;


COMMENT ON VIEW public.vista_movimientos_financieros IS
  'Log financiero en tres capas: activo (movimiento de bancos), pasivo (dinero '
  'de terceros: viajeros y agencias) e ingreso (lo que ToursRed gano), mas '
  'traspaso para el dinero que cambia de dueno sin mover las tres. Se cumple '
  'activo = pasivo + ingreso en cada categoria; la prueba lo exige. La columna '
  'se llama `caja` por compatibilidad, pero es movimiento de activo. Insumo de '
  '/admin/reporte-maestro. NO incluye gastos de operacion: no hay tabla donde '
  'capturarlos.';

-- `security_invoker = true` para que la vista NO sea un rodeo alrededor de las
-- RLS de las tablas de abajo. Sin eso, la vista correria con los permisos de
-- quien la creo y cualquiera con SELECT veria el dinero de todos.
REVOKE ALL ON public.vista_movimientos_financieros FROM PUBLIC;
REVOKE ALL ON public.vista_movimientos_financieros FROM anon;
GRANT SELECT ON public.vista_movimientos_financieros TO authenticated, service_role;
