-- ============================================================================
-- La comision que llega despues del asiento ya no se pierde
-- ============================================================================
--
-- QUE PROBLEMA RESUELVE
--
-- El asiento contable de un cobro se crea al confirmarse el pago. La comision
-- del procesador se conoce DESPUES —hay que preguntarsela al procesador— y se
-- escribe en `payment_transactions` con un UPDATE posterior. Pero el asiento ya
-- esta publicado, y una poliza publicada es INMUTABLE por diseño:
--
--     'Una poliza publicada no puede eliminarse; genere una reversa'
--     'Una poliza publicada es inmutable; genere una reversa'
--
-- Resultado: para todo cobro cuya comision llegue despues del asiento, el libro
-- la pierde PARA SIEMPRE. No hay nada que la vuelva a mirar.
--
-- Medido el 11-sep-2026 contra produccion: 12 asientos con comision real en
-- `payment_transactions` y CERO en el libro. $2,157.01 — $1,859.48 de gasto por
-- comision y $297.53 de IVA acreditable que nadie estaba acreditando.
--
-- Y ojo con el sintoma, porque explica por que nadie lo vio: `102 Bancos` se
-- cargo con el BRUTO en vez del neto, asi que el asiento cuadra perfecto
-- (debe = haber) y el balance tambien. Lo que esta mal es la CLASIFICACION:
-- dinero que nunca entro al banco figura como si hubiera entrado. Tercera vez
-- que muerde el mismo patron, despues de la membresia marcada como pasivo y
-- del tipo de cambio de relleno en los gastos recurrentes.
--
-- ----------------------------------------------------------------------------
-- LAS DOS CAUSAS, QUE SON DISTINTAS
-- ----------------------------------------------------------------------------
--
-- 1. UNA CARRERA, en `stripe-webhook`: disparaba `sync-booking-to-accounting`
--    unas lineas ANTES de consultar la comision a Stripe. No es que la comision
--    llegara dias despues — llegaba ~100 ms tarde, y el asiento ganaba siempre.
--    Eso se arregla reordenando, y se arreglo en el mismo PR que esta migracion.
--    Comprobado que los otros cuatro caminos ya escribian la comision ANTES:
--    conekta, openpay, mercadopago y capture-paypal-order.
--
-- 2. COMISIONES QUE LLEGAN TARDE DE VERDAD, y esas el orden no las salva:
--    - un backfill posterior (el asiento de PayPal I-2026-07-0008 es del
--      22-jul y su comision se escribio el 09-sep con el arreglo del #188);
--    - un webhook que reintenta o llega fuera de orden;
--    - una conciliacion manual contra el estado de cuenta del procesador.
--
-- Por eso hay DOS piezas: el orden cierra el caso comun, y esto cierra el resto.
--
-- ----------------------------------------------------------------------------
-- POR QUE UN ASIENTO DE AJUSTE Y NO TOCAR EL ORIGINAL
-- ----------------------------------------------------------------------------
--
-- Porque el sistema lo prohibe, y hace bien: una poliza publicada no se edita,
-- se corrige con otra. Esto genera una poliza de DIARIO por cada hueco:
--
--     604 Comisiones bancarias y pasarelas   D  (comision sin IVA)
--     108 IVA Acreditable                    D  (IVA de la comision)
--     102 Bancos                             H  (total, que nunca entro)
--
-- `source_type` es 'manual' y `source_id` es el asiento ORIGINAL. No es una
-- eleccion de estilo: `accounting_entries_source_type_check` tiene lista
-- cerrada y no admite un valor nuevo, y esa pareja le da a
-- `create_accounting_entry_atomic` su llave de idempotencia — volver a correr
-- esto no duplica nada, devuelve el ajuste que ya existe.
--
-- ----------------------------------------------------------------------------
-- EL MAPEO ASIENTO -> COBRO, QUE ES LA PARTE DELICADA
-- ----------------------------------------------------------------------------
--
-- Cada transaccion se atribuye a UN solo asiento, por su `charge_context`.
-- Escribirlo mal no da error: da un numero plausible. Al construirlo salieron
-- cuatro versiones malas antes de esta, y ninguna fallaba sola:
--
--   * comparar solo asientos de `booking` contra el cobro COMPLETO — ese
--     asiento cubre deposito + cargo de servicio; seguro y opcionales tienen
--     asientos propios. Ambitos distintos.
--   * mapear por «la transaccion mas reciente del booking», que es lo que hace
--     `create_accounting_entry_for_booking`: en una reserva con plan de pagos
--     esa es una MENSUALIDAD, y tres comisiones salian contadas dos veces.
--   * comparar `processor_fee_base` sin su cascada: esta NULA en MercadoPago y
--     Conekta, asi que diez asientos correctos parecian sobrar comision.
--
-- De ahi las tres reglas de abajo: mapeo por `charge_context`, un asiento por
-- transaccion, y la MISMA cascada que usa `create_accounting_entry_for_booking`
-- (`processor_fee_base` si esta, si no `processor_fee / 1.16`).
--
-- ----------------------------------------------------------------------------
-- LO QUE NO HACE
-- ----------------------------------------------------------------------------
--
-- No toca cobros sin comision registrada: ese es el trabajo de
-- `check_cobros_sin_comision` (20260911010000), que avisa cuando un cobro
-- liquidado sigue en cero. Este supone que la comision ya esta bien en
-- `payment_transactions` y solo se encarga de que llegue al libro.
--
-- No corrige un asiento cuya comision en libros sea MAYOR que la real: eso
-- seria un abono a 604, y un asiento que baja un gasto ya registrado merece
-- que lo mire una persona. Se detecta y se avisa; no se corrige solo.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Deteccion: que asientos no reflejan la comision de su cobro
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.comisiones_no_asentadas()
RETURNS TABLE (
  entry_id        uuid,
  entry_number    text,
  entry_date      date,
  source_type     text,
  procesador      text,
  base_real       numeric,
  iva_real        numeric,
  base_en_libros  numeric,
  iva_en_libros   numeric,
  d_base          numeric,
  d_iva           numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH mapeo AS (
    SELECT
      e.id AS entry_id, e.entry_number, e.entry_date, e.source_type,
      coalesce(t.payment_processor, '(sin procesador)') AS procesador,
      -- La MISMA cascada de create_accounting_entry_for_booking. Sin el
      -- coalesce, MercadoPago y Conekta —que no guardan el desglose— dan 0 y
      -- el asiento correcto parece tener comision de mas.
      coalesce(t.processor_fee_base, round(t.processor_fee / 1.16, 2)) AS base_real,
      coalesce(t.processor_fee_iva,
               t.processor_fee - round(t.processor_fee / 1.16, 2))     AS iva_real
    FROM public.accounting_entries e
    JOIN public.payment_transactions t
      -- Un asiento por transaccion, por charge_context. Mapear por «la mas
      -- reciente del booking» cuenta las mensualidades dos veces.
      ON  (e.source_type = 'booking'
           AND t.booking_id = e.source_id
           AND t.charge_context = 'booking_deposit')
       OR (e.source_type = 'payment_plan_installment'
           AND t.charge_reference_id = e.source_id
           AND t.charge_context = 'payment_plan_installment')
       OR (e.source_type = 'membership' AND t.id = e.source_id)
    WHERE t.status = 'succeeded'
      AND coalesce(t.processor_fee, 0) > 0
  )
  SELECT
    m.entry_id, m.entry_number, m.entry_date, m.source_type, m.procesador,
    m.base_real, m.iva_real,
    coalesce(l.base, 0), coalesce(l.iva, 0),
    round(m.base_real - coalesce(l.base, 0), 2),
    round(m.iva_real  - coalesce(l.iva,  0), 2)
  FROM mapeo m
  LEFT JOIN LATERAL (
    -- Suma el asiento original MAS su ajuste, si ya se genero. Sin esto la
    -- funcion reportaria eternamente los huecos que ella misma cerro.
    SELECT round(sum(x.debit) FILTER (WHERE x.account_code = '604'), 2) AS base,
           round(sum(x.debit) FILTER (WHERE x.account_code = '108'), 2) AS iva
    FROM public.accounting_entry_lines x
    JOIN public.accounting_entries ae ON ae.id = x.entry_id
    WHERE ae.id = m.entry_id
       OR (ae.source_type = 'manual' AND ae.source_id = m.entry_id)
  ) l ON true
  WHERE abs(m.base_real - coalesce(l.base, 0)) > 0.01
     OR abs(m.iva_real  - coalesce(l.iva,  0)) > 0.01;
$$;

COMMENT ON FUNCTION public.comisiones_no_asentadas IS
  'Asientos cuya comision de procesador no llego al libro. Mapea cada cobro a UN asiento por charge_context y usa la misma cascada base/1.16 que create_accounting_entry_for_booking. Cuenta el asiento original mas su ajuste, para no reportar lo ya corregido.';

-- ---------------------------------------------------------------------------
-- 2. Correccion: una poliza de diario por cada hueco
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.asentar_comisiones_faltantes()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fila    RECORD;
  v_nuevo   uuid;
  v_hechos  integer := 0;
  v_base    numeric := 0;
  v_iva     numeric := 0;
  v_revisar jsonb   := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'Acceso no autorizado';
  END IF;

  FOR v_fila IN SELECT * FROM public.comisiones_no_asentadas() LOOP
    -- Un delta negativo significa que el libro tiene MAS comision que el cobro.
    -- Corregirlo seria abonar a 604, o sea bajar un gasto ya registrado. Eso lo
    -- mira una persona; aqui solo se reporta.
    IF v_fila.d_base < 0 OR v_fila.d_iva < 0 THEN
      v_revisar := v_revisar || jsonb_build_object(
        'asiento', v_fila.entry_number,
        'motivo',  'el libro tiene mas comision que el cobro',
        'd_base',  v_fila.d_base,
        'd_iva',   v_fila.d_iva
      );
      CONTINUE;
    END IF;

    v_nuevo := public.create_accounting_entry_atomic(
      'diario',
      'Ajuste de comision de pasarela ' || v_fila.procesador
        || ' — ' || v_fila.entry_number,
      'manual',
      v_fila.entry_id,
      v_fila.entry_date,
      jsonb_build_array(
        jsonb_build_object(
          'account_code', '604', 'debit', v_fila.d_base, 'credit', 0,
          'description', 'Comision pasarela ' || v_fila.procesador
                      || ' no registrada en ' || v_fila.entry_number),
        jsonb_build_object(
          'account_code', '108', 'debit', v_fila.d_iva, 'credit', 0,
          'description', 'IVA acreditable de comision ' || v_fila.procesador),
        jsonb_build_object(
          'account_code', '102', 'debit', 0, 'credit', v_fila.d_base + v_fila.d_iva,
          'description', 'Ajuste: Bancos se cargo bruto en ' || v_fila.entry_number
                      || ', el deposito fue neto')
      )
    );

    IF v_nuevo IS NOT NULL THEN
      v_hechos := v_hechos + 1;
      v_base   := v_base + v_fila.d_base;
      v_iva    := v_iva  + v_fila.d_iva;
    END IF;
  END LOOP;

  IF jsonb_array_length(v_revisar) > 0 THEN
    BEGIN
      INSERT INTO public.audit_errors (error_message, sqlstate, raw_payload)
      VALUES (
        'Asientos con mas comision que el cobro: requieren revision humana',
        'P0000',
        jsonb_build_object('asientos', v_revisar)
      );
    EXCEPTION WHEN OTHERS THEN
      NULL;   -- que no poder dejar rastro no tumbe el ajuste
    END;
  END IF;

  RETURN jsonb_build_object(
    'ajustes',      v_hechos,
    'base',         round(v_base, 2),
    'iva',          round(v_iva, 2),
    'total',        round(v_base + v_iva, 2),
    'para_revisar', v_revisar
  );
END;
$$;

COMMENT ON FUNCTION public.asentar_comisiones_faltantes IS
  'Genera una poliza de diario por cada comision que no llego al libro: carga 604 y 108, abona 102. Idempotente por (source_type=manual, source_id=asiento original). No corrige deltas negativos — esos van a audit_errors para que los mire una persona.';

-- ---------------------------------------------------------------------------
-- 3. Programacion diaria
-- ---------------------------------------------------------------------------
-- Corre DESPUES de `cobros-sin-comision` (13:30) a proposito: primero se avisa
-- de los cobros que siguen sin comision, y una hora despues se asientan los que
-- ya la tienen. Al reves se asentarian huecos que el detector aun no reporto.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('comisiones-al-libro')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'comisiones-al-libro');

    PERFORM cron.schedule(
      'comisiones-al-libro',
      '30 14 * * *',   -- 08:30 hora de Ciudad de Mexico
      $cron$SELECT public.asentar_comisiones_faltantes();$cron$
    );
    RAISE NOTICE 'Programado: comisiones-al-libro, diario 14:30 UTC';
  ELSE
    RAISE WARNING 'pg_cron no esta instalado: las funciones quedan creadas pero SIN programar';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Aserciones
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_cuenta text;
BEGIN
  -- Las tres cuentas del ajuste tienen que existir y estar activas, o la
  -- funcion fallaria en produccion y no aqui.
  FOR v_cuenta IN SELECT unnest(ARRAY['604', '108', '102']) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.chart_of_accounts
      WHERE code = v_cuenta AND is_active
    ) THEN
      RAISE EXCEPTION 'Falta la cuenta % en el catalogo, o esta inactiva', v_cuenta;
    END IF;
  END LOOP;

  -- 'diario' y 'manual' tienen que pasar los CHECK, que son listas cerradas.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'accounting_entries_entry_type_check'
      AND pg_get_constraintdef(oid) LIKE '%diario%'
  ) THEN
    RAISE EXCEPTION 'entry_type no admite ''diario''';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'accounting_entries_source_type_check'
      AND pg_get_constraintdef(oid) LIKE '%manual%'
  ) THEN
    RAISE EXCEPTION 'source_type no admite ''manual''';
  END IF;

  RAISE NOTICE 'OK: cuentas 604/108/102 activas y los CHECK admiten diario/manual';
END
$$;
