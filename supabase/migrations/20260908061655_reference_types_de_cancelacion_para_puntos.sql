-- ============================================================================
-- R-1: la reversion de puntos al cancelar nunca ha ocurrido
--
-- QUE PASA HOY
--
-- Cuando se cancela un tour, el viajero DEBE perder los puntos que gano por esa
-- reserva (decision de producto confirmada por Axel el 08-sep-2026). El codigo
-- lo intenta: tres Edge Functions llaman a deduct_points al cancelar. Las tres
-- fallan, porque mandan un reference_type que el CHECK de
-- toursred_points_transactions rechaza:
--
--   process-tour-cancellation             'tour_cancellation'
--   process-agency-booking-cancellation   'agency_booking_cancellation'
--   process-payment-plan-tour-deadline    'payment_plan_auto_cancel'
--
-- Y el error se traga con console.error, asi que nadie lo vio. La evidencia en
-- datos: no existe UNA SOLA fila con esos tres reference_type.
--
-- Peor: process-tour-cancellation llama al marcador de trazabilidad en el
-- `else` del error, o sea que al fallar deduct_points tampoco se registra la
-- traza. Y markPointsAsClawedBack inserta filas con amount = 0 cuya
-- descripcion dice "ver deduccion real en type=redeemed del mismo booking",
-- apuntando a una fila que nunca se creo.
--
-- POR QUE SE AMPLIA EL CHECK Y NO SE CAMBIAN LOS LLAMADORES
--
-- La alternativa era que los tres reusaran un valor ya permitido
-- (admin_cancellation). Se descarto por tres razones:
--
--   1. Los nombres que ya eligieron los llamadores distinguen POR QUE se
--      quitaron los puntos: cancelacion del tour, cancelacion de una reserva
--      por la agencia, o auto-cancelacion por plan de pagos no liquidado. Esa
--      granularidad sirve para conciliar; aplanarla a un solo valor la pierde
--      para siempre.
--   2. Cambiar los llamadores obliga a redesplegar tres Edge Functions. Ampliar
--      el CHECK no despliega nada: es una migracion y ya.
--   3. Es lo que ya se hizo antes. admin_cancellation, traveler_cancellation,
--      membership, featured_slot y expiration NO estaban en el CREATE TABLE
--      original; se agregaron despues, por este mismo motivo.
--
-- LO QUE NO CAMBIA
--
-- El `type` sigue siendo 'redeemed', no 'clawback'. Es a proposito y es el
-- patron que ya funciona: la unica fila de cancelacion que existe hoy
-- (traveler_cancellation, escrita por process-traveler-cancellation) tambien es
-- 'redeemed'. En este esquema 'redeemed' es el movimiento real de saldo y
-- 'clawback' es el marcador de auditoria con amount = 0 que inserta
-- _shared/pointsTraceability.ts. Cambiar el type obligaria a tocar
-- deduct_points para TODOS sus llamadores, no solo los de cancelacion.
--
-- ALCANCE
--
-- Solo se amplia la lista. No se quita ningun valor, asi que ninguna fila
-- existente puede volverse invalida y la migracion no puede fallar por datos.
--
-- COMO COMPROBARLO DESPUES
--
-- Cancelar un tour de prueba que tenga una reserva con puntos ganados, y:
--
--   select type, reference_type, amount, description
--     from toursred_points_transactions
--    where reference_id = '<booking_id>'
--    order by created_at;
--
-- Esperado: una fila type='redeemed' con amount negativo (la deduccion real) y
-- las filas type='clawback' con amount=0 (la traza).
-- ============================================================================

ALTER TABLE public.toursred_points_transactions
  DROP CONSTRAINT IF EXISTS toursred_points_transactions_reference_type_check;

ALTER TABLE public.toursred_points_transactions
  ADD CONSTRAINT toursred_points_transactions_reference_type_check
  CHECK (reference_type IN (
    -- Valores que ya existian
    'booking',
    'adjustment',
    'promotion',
    'referral',
    'booking_partial_cancellation',
    'supplement_payment',
    'supplement',
    'payment_plan',
    'optional_service_payment',
    'insurance_payment',
    'post_booking_extra',
    'admin_cancellation',
    'traveler_cancellation',
    'membership',
    'featured_slot',
    'expiration',
    -- Agregados por R-1 (08-sep-2026): los tres caminos de cancelacion que
    -- llevaban meses fallando en silencio
    'tour_cancellation',
    'agency_booking_cancellation',
    'payment_plan_auto_cancel'
  ));
