-- Disputas (contracargos) y payouts de Stripe: donde guardarlos y como bloquear
-- el tour de una reserva en disputa.
--
-- Contexto: stripe-webhook atiende 13 eventos y NINGUNO es charge.dispute.* ni
-- payout.*. Una disputa llegaba y no la veia nadie; las disputas tienen ventana
-- de respuesta, asi que el costo de no verla no es perder el caso, es perderlo
-- por no contestar.
--
-- Sobre los payouts: en este repo NO hay Stripe Connect (cero transfers.create)
-- y agency_payouts es manual, con bank_reference y processed_by. Asi que
-- payout.paid/failed son Stripe depositando en la cuenta de ToursRed, no pagos
-- a agencias. Sirven para conciliar contra el estado de cuenta, y payout.failed
-- avisa que el dinero NO llego, que hoy no lo detectaba nada.

-- ---------------------------------------------------------------------------
-- 1. Disputas
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_disputes (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Idempotencia del webhook: Stripe reintenta, y cada reintento debe caer en
  -- la misma fila. Sin esto, un reintento duplicaria la alerta y el asiento.
  stripe_dispute_id        text NOT NULL UNIQUE,

  stripe_charge_id         text,
  stripe_payment_intent_id text,

  payment_transaction_id   uuid REFERENCES public.payment_transactions(id) ON DELETE SET NULL,
  booking_id               uuid REFERENCES public.bookings(id) ON DELETE SET NULL,

  amount                   numeric(12,2) NOT NULL,
  currency                 text NOT NULL DEFAULT 'mxn',
  reason                   text,
  status                   text NOT NULL,

  -- Fecha limite para subir evidencia. Es el dato con reloj: pasada esa fecha
  -- la disputa se pierde sin importar quien tenga razon.
  evidence_due_by          timestamptz,

  opened_at                timestamptz NOT NULL DEFAULT now(),
  closed_at                timestamptz,
  outcome                  text,

  funds_withdrawn_at       timestamptz,
  funds_reinstated_at      timestamptz,

  last_event_type          text,
  last_payload             jsonb,

  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.payment_disputes IS
  'Contracargos de Stripe. Una fila por dispute id; el webhook hace upsert sobre stripe_dispute_id para ser idempotente ante reintentos.';
COMMENT ON COLUMN public.payment_disputes.evidence_due_by IS
  'Fecha limite de Stripe para subir evidencia (evidence_details.due_by). Pasada esa fecha la disputa se pierde por silencio.';
COMMENT ON COLUMN public.payment_disputes.outcome IS
  'Resultado al cerrarse: won | lost | warning_closed | el estado terminal que reporte Stripe.';

CREATE INDEX IF NOT EXISTS idx_payment_disputes_booking ON public.payment_disputes(booking_id);
CREATE INDEX IF NOT EXISTS idx_payment_disputes_status  ON public.payment_disputes(status);
CREATE INDEX IF NOT EXISTS idx_payment_disputes_due     ON public.payment_disputes(evidence_due_by)
  WHERE closed_at IS NULL;

ALTER TABLE public.payment_disputes ENABLE ROW LEVEL SECURITY;

-- Solo admins. El webhook escribe con service_role, que no pasa por RLS.
CREATE POLICY admin_all_payment_disputes ON public.payment_disputes
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ---------------------------------------------------------------------------
-- 2. Payouts de Stripe hacia la cuenta de ToursRed
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stripe_payouts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_payout_id text NOT NULL UNIQUE,

  amount           numeric(12,2) NOT NULL,
  currency         text NOT NULL DEFAULT 'mxn',
  status           text NOT NULL,
  method           text,

  arrival_date     date,
  paid_at          timestamptz,
  failed_at        timestamptz,
  failure_code     text,
  failure_message  text,

  last_event_type  text,
  last_payload     jsonb,

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.stripe_payouts IS
  'Depositos de Stripe a la cuenta bancaria de ToursRed. NO son pagos a agencias: eso es agency_payouts y es manual. Sirven para conciliar contra el estado de cuenta.';

CREATE INDEX IF NOT EXISTS idx_stripe_payouts_arrival ON public.stripe_payouts(arrival_date DESC);
CREATE INDEX IF NOT EXISTS idx_stripe_payouts_status  ON public.stripe_payouts(status);

ALTER TABLE public.stripe_payouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_all_stripe_payouts ON public.stripe_payouts
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ---------------------------------------------------------------------------
-- 3. Bloqueo del tour mientras la disputa este abierta
-- ---------------------------------------------------------------------------
-- Columna nueva en vez de un estado nuevo: la maquina de estados de bookings es
-- la parte mas delicada del sistema y un contracargo no es una cancelacion.
-- NULL significa sin bloqueo, que es el valor de las 35 reservas existentes.
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS dispute_hold_at timestamptz;

COMMENT ON COLUMN public.bookings.dispute_hold_at IS
  'Fecha en que se bloqueo el check-in por una disputa abierta. NULL = sin bloqueo. Lo pone charge.dispute.created y lo limpia una disputa ganada. Lo lee confirm-booking-checkin.';

CREATE INDEX IF NOT EXISTS idx_bookings_dispute_hold ON public.bookings(dispute_hold_at)
  WHERE dispute_hold_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. Cuenta contable para contracargos
-- ---------------------------------------------------------------------------
-- 606 es "Reembolsos y cancelaciones"; un contracargo perdido es dinero que se
-- devuelve sin haberlo decidido nosotros, asi que cuelga de ahi.
-- sat_group_code es NOT NULL. Ojo: su valor NO es uniforme entre las hermanas
-- (606 usa '606-01', 606.02 usa '606' y 606.01 usa '601-01', que parece un
-- error en los datos ya cargados). Se usa '606', igual que 606.02, que es la
-- cuenta mas analoga: un costo de procesamiento que no se recupera. Vale la
-- pena que un contador confirme la agrupacion; no se toca 606.01 aqui.
--
-- level 4 como las hermanas, no 3: 606 es el nivel 3 y las 606.xx cuelgan de el.
INSERT INTO public.chart_of_accounts
  (code, sat_group_code, name, account_type, parent_code, level, nature, is_system, is_active, description)
VALUES
  ('606.03', '606', 'Contracargos por disputas', 'gasto', '606', 4, 'deudora', true, true,
   'Importe perdido en disputas de tarjeta resueltas en contra. Lo escribe stripe-webhook al recibir charge.dispute.closed con outcome lost.')
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4b. source_type para los asientos nuevos, y un defecto preexistente
-- ---------------------------------------------------------------------------
-- Causa distinta a todo lo anterior, se documenta aparte:
-- createStripeRefundFeeAccountingEntry (stripe-webhook) inserta
-- entry_type 'pago' y source_type 'payment_refund', y NINGUNO de los dos esta
-- permitido por los CHECK de accounting_entries: entry_type solo admite
-- ingreso/egreso/diario/apertura, y payment_refund no esta en la lista de
-- source_type. Ese asiento habria fallado siempre, en silencio, porque quien lo
-- llama solo hace console.error. Hoy no se nota: hay 0 reembolsos en la base.
--
-- Se agregan los dos valores que faltan. El entry_type equivocado se corrige en
-- el codigo de la funcion, no aqui.
ALTER TABLE public.accounting_entries
  DROP CONSTRAINT IF EXISTS accounting_entries_source_type_check;

ALTER TABLE public.accounting_entries
  ADD CONSTRAINT accounting_entries_source_type_check
  CHECK (source_type = ANY (ARRAY[
    'booking', 'payout', 'cancellation', 'manual', 'membership',
    'gift_card', 'gift_card_sale', 'gift_card_redemption', 'gift_card_expiration',
    'featured_slot', 'apertura', 'insurance_settlement', 'insurance_commission',
    'wallet_topup', 'executive_commission', 'insurance', 'supplement',
    'optional_service',
    'dispute',          -- nuevo: contracargos
    'payment_refund'    -- faltaba: lo usa createStripeRefundFeeAccountingEntry
  ]));

-- ---------------------------------------------------------------------------
-- 5. Tipos de notificacion
-- ---------------------------------------------------------------------------
-- ADD VALUE IF NOT EXISTS es valido dentro de transaccion en PG12+ siempre que
-- el valor no se USE en la misma transaccion. Aqui solo se declara; quien lo usa
-- es la Edge Function, en otra sesion.
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'payment_dispute_opened';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'stripe_payout_failed';

-- ---------------------------------------------------------------------------
-- 6. updated_at
-- ---------------------------------------------------------------------------
-- Se reusa update_updated_at_column(), que ya existe y ya la usan 2 triggers,
-- en vez de estrenar una segunda funcion que haga lo mismo.
DROP TRIGGER IF EXISTS trg_payment_disputes_updated_at ON public.payment_disputes;
CREATE TRIGGER trg_payment_disputes_updated_at
  BEFORE UPDATE ON public.payment_disputes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_stripe_payouts_updated_at ON public.stripe_payouts;
CREATE TRIGGER trg_stripe_payouts_updated_at
  BEFORE UPDATE ON public.stripe_payouts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
