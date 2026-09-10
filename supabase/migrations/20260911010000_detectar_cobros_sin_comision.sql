-- Detectar cobros sin comision de procesador
--
-- QUE PROBLEMA RESUELVE
--
-- Cada cobro tiene un costo --la comision del procesador-- y sin el la
-- contabilidad no cuadra: el neto figura igual al bruto y el margen que reporta
-- el ERP sale inflado.
--
-- Al medirlo el 10-sep-2026, de 41 cobros con monto, 30 tenian `net_amount`
-- igual a `amount`. La mayoria era historica, pero habia huecos vivos.
--
-- POR QUE UNA RED DE DATOS Y NO MAS PARCHES EN EL CODIGO
--
-- La comision la escriben ~20 sitios repartidos entre cinco webhooks y cuatro
-- caminos sincronos, cruzados con OCHO contextos de cobro (booking_deposit,
-- supplement, insurance, optional_service, payment_plan_installment,
-- membership, gift_card, featured_slot). Son 40 combinaciones que hoy se
-- mantienen a mano, cada una con su `charge_context` escrito literal.
--
-- Recorrer esa matriz y parchear celda por celda deja dos problemas: no se
-- puede demostrar que quedo completa, y el contexto que se agregue mañana nace
-- otra vez sin comision. Ya paso: `featured_slot` no estaba en la lista de
-- OpenPay, y nadie se entero hasta que alguien fue a contar.
--
-- Esto comprueba el RESULTADO en vez del camino: si un cobro quedo sin
-- comision, se ve aqui, lo haya escrito quien lo haya escrito. Cubre los cinco
-- procesadores, los ocho contextos, y los que vengan.
--
-- Mismo patron que `check_missing_tax_snapshots` (20260908191141), que hace
-- exactamente esto para los snapshots fiscales.
--
-- LO QUE NO HACE
--
-- No arregla el cobro ni lo bloquea: avisa. Bloquear un cobro porque el
-- procesador todavia no informo su comision seria peor que el problema —
-- muchas llegan por webhook minutos despues, y por eso hay ventana de gracia.

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_cobros_sin_comision()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Desde cuando se considera un hueco. Los cobros anteriores son historicos:
  -- Conekta no capturaba comision antes del 04-ago y OpenPay antes del 09-sep,
  -- asi que alertar por ellos seria ruido permanente y la guardia se aprenderia
  -- a ignorar. Se fija al momento de aplicar esta migracion.
  c_desde constant timestamptz := '2026-09-11 00:00:00+00';

  -- Cuanto se le da al webhook para llegar. La comision casi nunca se conoce
  -- en el momento del cobro: el camino sincrono inserta 0 como marcador y el
  -- webhook la rellena. Dos horas es holgado para cinco procesadores.
  c_gracia constant interval := interval '2 hours';

  v_total   integer := 0;
  v_detalle jsonb;
  v_admin   RECORD;
  v_texto   text;
BEGIN
  SELECT count(*), jsonb_agg(t)
  INTO v_total, v_detalle
  FROM (
    SELECT
      coalesce(payment_processor, '(sin procesador)') AS procesador,
      coalesce(charge_context, '(sin contexto)')      AS contexto,
      count(*)                                        AS cobros,
      round(sum(amount), 2)                           AS monto
    FROM public.payment_transactions
    WHERE status = 'succeeded'
      AND amount > 0
      AND coalesce(processor_fee, 0) = 0
      AND created_at >= c_desde
      AND created_at < now() - c_gracia
    GROUP BY 1, 2
    ORDER BY 3 DESC
  ) t;

  IF v_total = 0 THEN
    RETURN jsonb_build_object('ok', true, 'grupos', 0);
  END IF;

  -- Rastro consultable, que sobrevive a la rotacion de logs. Mismo destino que
  -- usan las snapshot_*_tax.
  BEGIN
    INSERT INTO public.audit_errors (error_message, sqlstate, raw_payload)
    VALUES (
      'Cobros liquidados sin comision de procesador',
      'P0000',
      jsonb_build_object('grupos', v_detalle, 'desde', c_desde, 'gracia', c_gracia::text)
    );
  EXCEPTION WHEN OTHERS THEN
    -- Que no poder dejar rastro no tumbe el aviso.
    NULL;
  END;

  v_texto := 'Hay cobros liquidados sin comision de procesador registrada. '
          || 'El neto figura igual al bruto y el margen sale inflado. Grupos: '
          || v_detalle::text;

  FOR v_admin IN
    SELECT id FROM public.users
    WHERE role IN ('admin', 'super_admin') AND is_active
  LOOP
    INSERT INTO public.notifications (user_id, type, title, message, data)
    VALUES (
      v_admin.id,
      'cobros_sin_comision',
      'Cobros sin comision de procesador',
      v_texto,
      jsonb_build_object('grupos', v_detalle)
    );
  END LOOP;

  RETURN jsonb_build_object('ok', false, 'grupos', v_total, 'detalle', v_detalle);
END;
$$;

COMMENT ON FUNCTION public.check_cobros_sin_comision IS
  'Detecta cobros liquidados cuya comision de procesador quedo en 0 pasada la ventana de gracia. Comprueba el resultado, no el camino: cubre los cinco procesadores y los ocho charge_context. Corre a diario por pg_cron.';

-- ---------------------------------------------------------------------------
-- Programacion
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('cobros-sin-comision')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cobros-sin-comision');

    PERFORM cron.schedule(
      'cobros-sin-comision',
      '30 13 * * *',   -- 07:30 hora de Ciudad de Mexico
      $cron$SELECT public.check_cobros_sin_comision();$cron$
    );
    RAISE NOTICE 'Programado: cobros-sin-comision, diario 13:30 UTC';
  ELSE
    RAISE WARNING 'pg_cron no esta instalado: la funcion queda creada pero SIN programar';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Aserciones
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_res jsonb;
BEGIN
  -- Que corra sin reventar y devuelva la forma esperada.
  v_res := public.check_cobros_sin_comision();
  ASSERT v_res ? 'ok', 'check_cobros_sin_comision no devolvio la clave ok';

  -- Que no alerte por el historico: todos los cobros existentes son anteriores
  -- al corte, asi que en el momento de aplicar esto tiene que dar 0 grupos.
  ASSERT (v_res->>'ok')::boolean, format(
    'La funcion alerto al instalarse (%s). El corte c_desde deberia dejar fuera todo lo historico.',
    v_res::text);
END
$$;
