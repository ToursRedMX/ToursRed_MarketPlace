-- payment_transactions.booking_id era NOT NULL, lo que impedia registrar
-- cualquier cobro que no cuelgue de una reserva.
--
-- YA BLOQUEO DOS FLUJOS DE NEGOCIO, los dos en silencio:
--
--   1. Membresias. El insert de invoice.payment_succeeded en stripe-webhook
--      no manda booking_id (una membresia no tiene reserva) y reventaba. El
--      codigo no destructuraba `error`, asi que fallaba mudo: sin transaccion
--      no habia membershipTxId, y sin eso create_accounting_entry_for_membership
--      nunca corria. Resultado: ninguna membresia genero asiento contable.
--
--      Verificado el 08-sep-2026 reenviando un evento real
--      (evt_1U9AvdEs5wtTyCYmh8eEIUx5). El log de Postgres dijo textual:
--      'null value in column "booking_id" of relation "payment_transactions"
--       violates not-null constraint'
--
--   2. Tours destacados. conekta-webhook/index.ts:150 documenta el mismo
--      choque —"los tours destacados no tienen payment_transactions
--      (booking_id es NOT NULL"— y lo rodea con un fallback en vez de
--      registrar el cobro.
--
-- POR QUE UN CHECK Y NO SOLO QUITAR EL NOT NULL:
--
-- De los 8 valores de charge_context que usa el codigo, solo tres carecen de
-- reserva por diseno: membership, featured_slot y gift_card. Los otros cinco
-- (booking_deposit, insurance, optional_service, payment_plan_installment,
-- supplement) siempre deben traerla. Aflojar la columna sin mas dejaria pasar
-- un cobro de reserva sin reserva, que es justo lo que el NOT NULL protegia.
--
-- El CHECK conserva esa proteccion donde importa. Un charge_context nuevo que
-- se olvide de mandar booking_id sigue fallando: la direccion segura.
--
-- IMPACTO EN DATOS: ninguno. Al aplicarla hay 45 filas, todas booking_deposit
-- (41) o payment_plan_installment (4), y las 45 traen booking_id.
--
-- IMPACTO EN REPORTES: a partir de aqui, agrupar payment_transactions por
-- booking_id produce un grupo NULL con membresias, gift cards y destacados.
-- Es correcto —esos ingresos no son de una reserva— pero cambia los numeros
-- de cualquier tablero que asumiera lo contrario.

ALTER TABLE public.payment_transactions
  ALTER COLUMN booking_id DROP NOT NULL;

ALTER TABLE public.payment_transactions
  ADD CONSTRAINT payment_transactions_booking_id_requerido
  CHECK (
    booking_id IS NOT NULL
    OR charge_context IN ('membership', 'featured_slot', 'gift_card')
  );

-- Verificacion: la columna quedo nullable y el constraint existe.
DO $$
BEGIN
  IF (SELECT is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'payment_transactions'
        AND column_name = 'booking_id') <> 'YES' THEN
    RAISE EXCEPTION 'booking_id sigue siendo NOT NULL';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'payment_transactions_booking_id_requerido') THEN
    RAISE EXCEPTION 'no se creo el constraint payment_transactions_booking_id_requerido';
  END IF;

  RAISE NOTICE 'OK: booking_id nullable con CHECK por charge_context';
END $$;
