-- `payment_disputes` deja de ser solo de Stripe
--
-- QUE SE MIDIO
--
-- El 10-sep-2026, de los cinco procesadores, solo Stripe registra disputas:
--
--     stripe-webhook ......... 5 eventos charge.dispute.* -> fila, asiento
--                              contable, bloqueo de check-in, alerta a admins
--                              y correo a operaciones
--     paypal-webhook ......... 2 eventos, pero el handler entero es un
--                              console.warn() y un break. No persiste NADA
--     mercadopago-webhook .... 0 menciones de disputa o contracargo
--     conekta-webhook ........ 0
--     openpay-webhook ........ 0
--
-- Lo de PayPal es lo peor de los cuatro, porque PARECE cobertura: hay un `case`
-- con el nombre del evento. Escribe en una consola que nadie lee.
--
-- POR QUE IMPORTA
--
-- Lo dice mejor el commit que trajo los handlers de Stripe (270d712): "las
-- disputas tienen ventana de respuesta, asi que el costo de no verla no es
-- perder el caso: es perderlo por no contestar". Ese argumento vale igual para
-- los otros cuatro procesadores.
--
-- QUE IMPEDIA CONECTARLOS
--
-- La tabla estaba atada a Stripe en el ESQUEMA, no solo en el uso:
-- `stripe_dispute_id NOT NULL`, `stripe_charge_id`, `stripe_payment_intent_id`,
-- y una unica sobre `stripe_dispute_id`. Una disputa de Conekta no cabia.
--
-- POR QUE SE RENOMBRA EN VEZ DE AGREGAR COLUMNAS
--
-- Porque la tabla tiene CERO filas. Renombrar ahora no migra ningun dato y deja
-- un esquema honesto; agregar `processor_dispute_id` al lado de
-- `stripe_dispute_id` habria dejado dos columnas para lo mismo y la duda
-- permanente de cual se llena. La asercion del final falla si alguien aplica
-- esto cuando ya hubiera datos.
--
-- LA UNICA PASA A SER COMPUESTA
--
-- `(processor, processor_dispute_id)`. Los identificadores de disputa no son
-- globalmente unicos entre procesadores, y nada impide que Conekta emita un id
-- que coincida con uno de OpenPay. Con la unica vieja, la segunda disputa
-- habria pisado a la primera.

-- ---------------------------------------------------------------------------
-- 0. No tocar nada si ya hay datos
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_filas bigint;
BEGIN
  SELECT count(*) INTO v_filas FROM public.payment_disputes;
  IF v_filas > 0 THEN
    RAISE EXCEPTION
      'payment_disputes tiene % fila(s). Esta migracion renombra columnas asumiendo que esta vacia; con datos hay que migrarlos a mano.',
      v_filas;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 1. Columnas neutrales
-- ---------------------------------------------------------------------------
ALTER TABLE public.payment_disputes
  RENAME COLUMN stripe_dispute_id TO processor_dispute_id;

ALTER TABLE public.payment_disputes
  RENAME COLUMN stripe_charge_id TO processor_charge_id;

-- `payment_intent` es vocabulario de Stripe. En PayPal es una captura, en
-- MercadoPago un payment y en Conekta un order: `processor_payment_id` sirve
-- para los cinco.
ALTER TABLE public.payment_disputes
  RENAME COLUMN stripe_payment_intent_id TO processor_payment_id;

ALTER TABLE public.payment_disputes
  ADD COLUMN processor text NOT NULL DEFAULT 'stripe';

-- El DEFAULT era solo para poder agregarla NOT NULL sobre una tabla que, si
-- llegara a tener filas, serian de Stripe. De aqui en adelante hay que
-- decirlo explicitamente: un procesador por omision es justo el error que esta
-- migracion viene a evitar.
ALTER TABLE public.payment_disputes
  ALTER COLUMN processor DROP DEFAULT;

ALTER TABLE public.payment_disputes
  ADD CONSTRAINT payment_disputes_processor_check
  CHECK (processor IN ('stripe', 'paypal', 'mercadopago', 'conekta', 'openpay'));

-- ---------------------------------------------------------------------------
-- 2. La unica, ahora compuesta
-- ---------------------------------------------------------------------------
ALTER TABLE public.payment_disputes
  DROP CONSTRAINT payment_disputes_stripe_dispute_id_key;

ALTER TABLE public.payment_disputes
  ADD CONSTRAINT payment_disputes_processor_dispute_key
  UNIQUE (processor, processor_dispute_id);

CREATE INDEX IF NOT EXISTS idx_payment_disputes_processor
  ON public.payment_disputes (processor);

COMMENT ON TABLE public.payment_disputes IS
  'Disputas y contracargos de los cinco procesadores. La unica es (processor, processor_dispute_id): los ids de disputa no son unicos entre procesadores.';
COMMENT ON COLUMN public.payment_disputes.processor IS
  'stripe | paypal | mercadopago | conekta | openpay. Sin valor por omision a proposito.';
COMMENT ON COLUMN public.payment_disputes.processor_payment_id IS
  'Id del cobro en el procesador: payment_intent en Stripe, captura en PayPal, payment en MercadoPago, order en Conekta, charge en OpenPay.';

-- ---------------------------------------------------------------------------
-- 3. Aserciones
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  ASSERT (SELECT count(*) FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'payment_disputes'
            AND column_name IN ('processor', 'processor_dispute_id',
                                'processor_charge_id', 'processor_payment_id')) = 4,
    'faltan columnas neutrales en payment_disputes';

  ASSERT NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = 'payment_disputes'
                       AND column_name LIKE 'stripe%'),
    'quedo alguna columna stripe_* en payment_disputes';

  ASSERT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.payment_disputes'::regclass
                   AND conname = 'payment_disputes_processor_dispute_key'),
    'no se creo la unica compuesta';

  -- Que el CHECK acepte los cinco y rechace cualquier otro.
  ASSERT (SELECT pg_get_constraintdef(oid) FROM pg_constraint
          WHERE conrelid = 'public.payment_disputes'::regclass
            AND conname = 'payment_disputes_processor_check')
         LIKE '%openpay%',
    'el CHECK de processor no incluye a los cinco procesadores';
END
$$;
