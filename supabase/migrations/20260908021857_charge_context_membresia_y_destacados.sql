-- Completa 20260908021728. Esa migracion hizo booking_id nullable, pero el
-- insert de membresia seguia fallando un paso despues: payment_transactions
-- tiene ADEMAS una lista blanca de charge_context que no incluye 'membership'.
--
--   CHECK (charge_context = ANY (ARRAY[
--     'booking_deposit','payment_plan_installment','supplement',
--     'insurance','optional_service','gift_card']))
--
-- Detectado al probar el constraint anterior con un insert real en vez de
-- darlo por bueno: el rechazo vino de payment_transactions_charge_context_check,
-- no del NOT NULL.
--
-- Se agregan los dos contextos que el codigo ya usa y la lista ignoraba:
--
--   membership    -> stripe-webhook, handler de invoice.payment_succeeded
--   featured_slot -> tours destacados. conekta-webhook:150 documenta que hoy
--                    NO registran payment_transactions por este mismo choque
--
-- Son exactamente los dos que 20260908021728 exime de traer booking_id, asi
-- que las dos reglas quedan alineadas: los tres cobros sin reserva
-- (membership, featured_slot, gift_card) son validos y el resto sigue
-- exigiendo booking_id.
--
-- IMPACTO EN DATOS: ninguno. Las 45 filas existentes son booking_deposit (41)
-- y payment_plan_installment (4), ambos ya en la lista.

ALTER TABLE public.payment_transactions
  DROP CONSTRAINT payment_transactions_charge_context_check;

ALTER TABLE public.payment_transactions
  ADD CONSTRAINT payment_transactions_charge_context_check
  CHECK (charge_context = ANY (ARRAY[
    'booking_deposit'::text,
    'payment_plan_installment'::text,
    'supplement'::text,
    'insurance'::text,
    'optional_service'::text,
    'gift_card'::text,
    'membership'::text,
    'featured_slot'::text
  ]));

DO $$
BEGIN
  IF pg_get_constraintdef((
        SELECT oid FROM pg_constraint
        WHERE conname = 'payment_transactions_charge_context_check'
          AND conrelid = 'public.payment_transactions'::regclass
     )) NOT LIKE '%membership%' THEN
    RAISE EXCEPTION 'el constraint no quedo con membership';
  END IF;
  RAISE NOTICE 'OK: charge_context acepta membership y featured_slot';
END $$;
