-- ============================================================================
-- Pagar un gasto de operacion: despues de registrarlo, y en parcialidades
-- ============================================================================
--
-- Prueba `pagar_gasto_operacion` y el bloque 19 de la vista tras
-- `20260911040000`, contra un Postgres de verdad y sobre la cadena completa de
-- migraciones, no sobre un esquema inventado.
--
-- QUE CUBRE Y POR QUE
--
--   1. Un gasto por pagar figura como DEUDA, no como salida de banco.
--   2. Un pago PARCIAL parte el movimiento: caja por lo pagado, pasivo por el
--      resto. El campo `pagado_en` es una fecha y no sabe hacer esto: por eso
--      existe `pagos_de_gasto`.
--   3. Al completar el saldo, `pagado_en` se escribe SOLO — nunca a mano, que
--      es lo que separaba la vista del libro.
--   4. El asiento de cada pago es 205 D / 102 H y cuadra.
--   5. Un sobrepago se rechaza: dejaria 205 en deudor, diciendo que el
--      proveedor te debe a ti.
--   6. Un borrador no se puede pagar: todavia no hay deuda.
--   7. El gasto capturado YA PAGADO tambien deja su fila, apuntando a su MISMO
--      asiento y sin generar uno segundo. Sin esto la vista lo veria como no
--      pagado, porque ahora suma pagos.
--   8. El invariante caja = pasivo + ingreso se sostiene en los tres estados.
--
--   psql -f scripts/test-pagar-gasto.sql
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;

\ir fixture-movimientos.sql
\ir ../supabase/migrations/20260910080000_vista_movimientos_financieros.sql
\ir ../supabase/migrations/20260910200000_corregir_membresia_y_pasivo_por_comisiones.sql
\ir ../supabase/migrations/20260910240000_captura_de_gastos_de_operacion.sql
\ir ../supabase/migrations/20260910250000_tipo_de_cambio_pendiente_en_recurrentes.sql
\ir ../supabase/migrations/20260911020000_autor_del_gasto_por_defecto.sql
\ir ../supabase/migrations/20260911040000_pagar_gasto_en_parcialidades.sql

-- El permiso se da por bueno: lo prueba test-gastos-operacion.sql.
CREATE OR REPLACE FUNCTION public.puede_gestionar_gastos() RETURNS boolean
  LANGUAGE sql STABLE AS $$ SELECT true $$;

DO $$
DECLARE
  v_gasto   uuid;
  v_pagado  uuid;
  v_caja    numeric;
  v_pasivo  numeric;
  v_ing     numeric;
  v_n       integer;
  v_d       numeric;
  v_h       numeric;
  v_fecha   date;
BEGIN
  -- =========================================================================
  -- 1. Un gasto POR PAGAR es deuda, no salida de banco
  -- =========================================================================
  INSERT INTO public.gastos_operacion
    (fecha, cuenta_contable, proveedor, descripcion, moneda, tipo_cambio,
     subtotal, iva, total, total_mxn)
  VALUES ('2026-07-01','601.02','TIKTOK','Publicidad','MXN',1,200,32,232,232)
  RETURNING id INTO v_gasto;

  PERFORM public.registrar_gasto_operacion(v_gasto);

  SELECT caja, pasivo, ingreso INTO v_caja, v_pasivo, v_ing
  FROM public.vista_movimientos_financieros WHERE origen_id = v_gasto;

  IF v_caja <> 0 OR v_pasivo <> 232 OR v_ing <> -232 THEN
    RAISE EXCEPTION 'Caso 1: por pagar deberia ser caja 0 / pasivo 232 / ingreso -232, y es % / % / %',
      v_caja, v_pasivo, v_ing;
  END IF;
  IF abs(v_caja - (v_pasivo + v_ing)) > 0.01 THEN
    RAISE EXCEPTION 'Caso 1: el invariante no se sostiene';
  END IF;

  -- =========================================================================
  -- 2. Pago PARCIAL: caja por lo pagado, pasivo por el resto
  -- =========================================================================
  PERFORM public.pagar_gasto_operacion(v_gasto, '2026-07-15', 100, 'spei', 'REF-1');

  SELECT caja, pasivo, ingreso INTO v_caja, v_pasivo, v_ing
  FROM public.vista_movimientos_financieros WHERE origen_id = v_gasto;

  IF v_caja <> -100 OR v_pasivo <> 132 THEN
    RAISE EXCEPTION 'Caso 2: con 100 de 232 deberia ser caja -100 / pasivo 132, y es % / %',
      v_caja, v_pasivo;
  END IF;
  IF abs(v_caja - (v_pasivo + v_ing)) > 0.01 THEN
    RAISE EXCEPTION 'Caso 2: el invariante no se sostiene con un pago parcial';
  END IF;

  -- Y el gasto NO se marca pagado todavia.
  SELECT pagado_en INTO v_fecha FROM public.gastos_operacion WHERE id = v_gasto;
  IF v_fecha IS NOT NULL THEN
    RAISE EXCEPTION 'Caso 2: un pago parcial no puede marcar el gasto como pagado';
  END IF;

  -- =========================================================================
  -- 3. El asiento del pago es 205 D / 102 H y cuadra
  -- =========================================================================
  SELECT sum(l.debit) FILTER (WHERE l.account_code='205'),
         sum(l.credit) FILTER (WHERE l.account_code='102')
  INTO v_d, v_h
  FROM public.accounting_entry_lines l
  JOIN public.pagos_de_gasto p ON p.asiento_id = l.entry_id
  WHERE p.gasto_id = v_gasto;

  IF coalesce(v_d,0) <> 100 OR coalesce(v_h,0) <> 100 THEN
    RAISE EXCEPTION 'Caso 3: el asiento del pago deberia ser 205 D 100 / 102 H 100, y es % / %',
      coalesce(v_d,0), coalesce(v_h,0);
  END IF;

  -- =========================================================================
  -- 4. Sobrepago rechazado: dejaria 205 en deudor
  -- =========================================================================
  BEGIN
    PERFORM public.pagar_gasto_operacion(v_gasto, '2026-07-20', 200);
    RAISE EXCEPTION 'Caso 4: un pago de 200 sobre un saldo de 132 tuvo que rechazarse';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%excede el saldo%' THEN RAISE; END IF;
  END;

  -- =========================================================================
  -- 5. Un pago anterior al gasto se rechaza
  -- =========================================================================
  BEGIN
    PERFORM public.pagar_gasto_operacion(v_gasto, '2026-06-01', 10);
    RAISE EXCEPTION 'Caso 5: un pago anterior a la factura tuvo que rechazarse';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%anterior al gasto%' THEN RAISE; END IF;
  END;

  -- =========================================================================
  -- 6. Completar el saldo: `pagado_en` se escribe SOLO
  -- =========================================================================
  PERFORM public.pagar_gasto_operacion(v_gasto, '2026-07-31', 132, 'transferencia');

  SELECT pagado_en INTO v_fecha FROM public.gastos_operacion WHERE id = v_gasto;
  IF v_fecha <> '2026-07-31' THEN
    RAISE EXCEPTION 'Caso 6: al saldar, pagado_en deberia ser 2026-07-31 y es %', v_fecha;
  END IF;

  SELECT caja, pasivo INTO v_caja, v_pasivo
  FROM public.vista_movimientos_financieros WHERE origen_id = v_gasto;
  IF v_caja <> -232 OR v_pasivo <> 0 THEN
    RAISE EXCEPTION 'Caso 6: saldado deberia ser caja -232 / pasivo 0, y es % / %', v_caja, v_pasivo;
  END IF;

  -- Dos pagos, dos asientos.
  SELECT count(*) INTO v_n FROM public.pagos_de_gasto WHERE gasto_id = v_gasto;
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'Caso 6: deberian existir 2 pagos y hay %', v_n;
  END IF;

  -- =========================================================================
  -- 7. Ya saldado: no se puede volver a pagar
  -- =========================================================================
  BEGIN
    PERFORM public.pagar_gasto_operacion(v_gasto, '2026-08-01', 1);
    RAISE EXCEPTION 'Caso 7: un gasto saldado no puede recibir mas pagos';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%ya esta pagado%' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'Casos 1-7 OK';
END $$;

-- ===========================================================================
-- 8. Un BORRADOR no se puede pagar
-- ===========================================================================
DO $$
DECLARE v_g uuid;
BEGIN
  INSERT INTO public.gastos_operacion
    (fecha, cuenta_contable, proveedor, descripcion, moneda, tipo_cambio,
     subtotal, iva, total, total_mxn)
  VALUES ('2026-08-01','601.01','TELCEL','Internet','MXN',1,100,16,116,116)
  RETURNING id INTO v_g;

  BEGIN
    PERFORM public.pagar_gasto_operacion(v_g, '2026-08-02', 50);
    RAISE EXCEPTION 'Caso 8: un borrador no genero deuda, no puede pagarse';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Registra el gasto antes%' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'Caso 8 OK';
END $$;

-- ===========================================================================
-- 9. El gasto capturado YA PAGADO deja su fila, y NO un segundo asiento
-- ===========================================================================
DO $$
DECLARE
  v_g uuid; v_n integer; v_caja numeric; v_pasivo numeric; v_asiento uuid;
BEGIN
  INSERT INTO public.gastos_operacion
    (fecha, cuenta_contable, proveedor, descripcion, moneda, tipo_cambio,
     subtotal, iva, total, total_mxn, pagado_en, metodo_pago)
  VALUES ('2026-08-10','602','ANTHROPIC','Claude','MXN',1,500,80,580,580,
          '2026-08-10','tarjeta')
  RETURNING id INTO v_g;

  SELECT public.registrar_gasto_operacion(v_g) INTO v_asiento;

  -- La fila existe...
  SELECT count(*) INTO v_n FROM public.pagos_de_gasto WHERE gasto_id = v_g;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'Caso 9: un gasto capturado ya pagado debe dejar 1 fila de pago y dejo %', v_n;
  END IF;

  -- ...apuntando al MISMO asiento, sin crear uno segundo.
  IF NOT EXISTS (SELECT 1 FROM public.pagos_de_gasto
                 WHERE gasto_id = v_g AND asiento_id = v_asiento) THEN
    RAISE EXCEPTION 'Caso 9: la fila debe apuntar al asiento del propio gasto';
  END IF;

  SELECT count(*) INTO v_n FROM public.accounting_entries
  WHERE source_type = 'gasto_operacion' AND description LIKE '%ANTHROPIC%';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'Caso 9: no debe generarse un segundo asiento; hay %', v_n;
  END IF;

  -- Y la vista lo ve pagado, que es lo que rompia sin la fila.
  SELECT caja, pasivo INTO v_caja, v_pasivo
  FROM public.vista_movimientos_financieros WHERE origen_id = v_g;
  IF v_caja <> -580 OR v_pasivo <> 0 THEN
    RAISE EXCEPTION 'Caso 9: pagado al capturar deberia ser caja -580 / pasivo 0, y es % / %',
      v_caja, v_pasivo;
  END IF;

  RAISE NOTICE 'Caso 9 OK';
END $$;

-- ===========================================================================
-- 10. El invariante por categoria, con los tres estados conviviendo
-- ===========================================================================
DO $$
DECLARE v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM (
    SELECT categoria FROM public.vista_movimientos_financieros
    GROUP BY categoria
    HAVING abs(sum(caja) - (sum(pasivo) + sum(ingreso))) > 0.01
  ) x;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'Caso 10: % categorias descuadradas con pagos parciales en juego', v_n;
  END IF;
  RAISE NOTICE 'Caso 10 OK';
END $$;

ROLLBACK;

\echo 'Pagar gasto de operacion: 10/10 casos OK'
