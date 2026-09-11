-- ===========================================================================
-- El pago de un gasto cae en SU fecha, no en la del gasto
-- ===========================================================================
--
-- Lo que estas pruebas cazan y las anteriores no: el invariante
-- `caja = pasivo + ingreso` es CIEGO AL TIEMPO. Una fila puede cuadrar al
-- centavo y estar en el mes equivocado. Por eso aqui casi todo se afirma
-- contra una VENTANA DE FECHAS, que es como el reporte maestro consulta.
--
-- El caso que motivo todo: TikTok, devengado el 1-jul y pagado el 11-sep. El
-- bloque 19 viejo reportaba los 232 como salida de banco del 1 de julio.
--
--   psql -v ON_ERROR_STOP=1 -f test-fecha-del-pago.sql
-- ===========================================================================

BEGIN;

\ir fixture-movimientos.sql
\ir ../supabase/migrations/20260910080000_vista_movimientos_financieros.sql
\ir ../supabase/migrations/20260910200000_corregir_membresia_y_pasivo_por_comisiones.sql
\ir ../supabase/migrations/20260910240000_captura_de_gastos_de_operacion.sql
\ir ../supabase/migrations/20260910250000_tipo_de_cambio_pendiente_en_recurrentes.sql
\ir ../supabase/migrations/20260911020000_autor_del_gasto_por_defecto.sql
\ir ../supabase/migrations/20260911040000_pagar_gasto_en_parcialidades.sql
\ir ../supabase/migrations/20260911050000_pago_de_gasto_no_toca_la_poliza.sql
-- La que se prueba: el pago deja de heredar la fecha del gasto.
\ir ../supabase/migrations/20260911060000_el_pago_del_gasto_lleva_su_fecha.sql

CREATE OR REPLACE FUNCTION public.puede_gestionar_gastos() RETURNS boolean
  LANGUAGE sql STABLE AS $$ SELECT true $$;

-- ===========================================================================
-- 1. El caso de TikTok, tal cual paso: devengo en julio, pagos en septiembre
-- ===========================================================================
DO $$
DECLARE
  v_gasto  uuid;
  v_caja   numeric;
  v_pasivo numeric;
  v_ing    numeric;
  v_n      integer;
BEGIN
  INSERT INTO public.gastos_operacion
    (fecha, cuenta_contable, proveedor, descripcion, moneda, tipo_cambio,
     subtotal, iva, total, total_mxn)
  VALUES ('2026-07-01','602','TIKTOK','Publicidad','MXN',1,200,32,232,232)
  RETURNING id INTO v_gasto;

  PERFORM public.registrar_gasto_operacion(v_gasto);
  PERFORM public.pagar_gasto_operacion(v_gasto, '2026-09-11', 100, 'tarjeta', '1234');
  PERFORM public.pagar_gasto_operacion(v_gasto, '2026-09-11', 132, 'tarjeta', '9876');

  -- ------------------------------------------------------------------
  -- JULIO: nace la deuda y el costo. El banco NO se mueve.
  -- ------------------------------------------------------------------
  SELECT coalesce(sum(caja),0), coalesce(sum(pasivo),0), coalesce(sum(ingreso),0)
  INTO v_caja, v_pasivo, v_ing
  FROM public.vista_movimientos_financieros
  WHERE origen_id = v_gasto
    AND fecha >= '2026-07-01' AND fecha < '2026-08-01';

  IF v_caja <> 0 THEN
    RAISE EXCEPTION 'Caso 1: en julio NO salio dinero del banco, y la vista dice %', v_caja;
  END IF;
  IF v_pasivo <> 232 OR v_ing <> -232 THEN
    RAISE EXCEPTION 'Caso 1: julio deberia ser pasivo 232 / ingreso -232, y es % / %',
      v_pasivo, v_ing;
  END IF;

  -- ------------------------------------------------------------------
  -- SEPTIEMBRE: salen los 232 y se extingue la deuda.
  -- ------------------------------------------------------------------
  SELECT coalesce(sum(caja),0), coalesce(sum(pasivo),0), coalesce(sum(ingreso),0)
  INTO v_caja, v_pasivo, v_ing
  FROM public.vista_movimientos_financieros
  WHERE origen_tabla = 'pagos_de_gasto'
    AND fecha >= '2026-09-01' AND fecha < '2026-10-01';

  IF v_caja <> -232 THEN
    RAISE EXCEPTION 'Caso 1: en septiembre salieron 232 del banco, y la vista dice %', v_caja;
  END IF;
  IF v_pasivo <> -232 OR v_ing <> 0 THEN
    RAISE EXCEPTION 'Caso 1: septiembre deberia ser pasivo -232 / ingreso 0, y es % / %',
      v_pasivo, v_ing;
  END IF;

  -- ------------------------------------------------------------------
  -- AGOSTO: entre medias no pasa nada.
  -- ------------------------------------------------------------------
  SELECT count(*) INTO v_n
  FROM public.vista_movimientos_financieros
  WHERE (origen_id = v_gasto OR origen_tabla = 'pagos_de_gasto')
    AND fecha >= '2026-08-01' AND fecha < '2026-09-01';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'Caso 1: agosto no deberia tener movimientos y tiene %', v_n;
  END IF;

  RAISE NOTICE 'Caso 1 OK';
END $$;

-- ===========================================================================
-- 2. Los totales de siempre no se movieron
-- ===========================================================================
-- La correccion reparte en el tiempo; no puede cambiar cuanto.
DO $$
DECLARE v_caja numeric; v_pasivo numeric; v_ing numeric;
BEGIN
  SELECT coalesce(sum(caja),0), coalesce(sum(pasivo),0), coalesce(sum(ingreso),0)
  INTO v_caja, v_pasivo, v_ing
  FROM public.vista_movimientos_financieros
  WHERE origen_tabla IN ('gastos_operacion','pagos_de_gasto');

  IF v_caja <> -232 OR v_pasivo <> 0 OR v_ing <> -232 THEN
    RAISE EXCEPTION 'Caso 2: el total deberia seguir siendo caja -232 / pasivo 0 / ingreso -232, y es % / % / %',
      v_caja, v_pasivo, v_ing;
  END IF;
  RAISE NOTICE 'Caso 2 OK';
END $$;

-- ===========================================================================
-- 3. Un pago PARCIAL en otro mes deja la deuda viva en el mes del devengo
-- ===========================================================================
DO $$
DECLARE
  v_gasto  uuid;
  v_caja   numeric;
  v_pasivo numeric;
BEGIN
  INSERT INTO public.gastos_operacion
    (fecha, cuenta_contable, proveedor, descripcion, moneda, tipo_cambio,
     subtotal, iva, total, total_mxn)
  VALUES ('2026-07-05','601.01','PARCIAL','Servicio','MXN',1,1000,160,1160,1160)
  RETURNING id INTO v_gasto;

  PERFORM public.registrar_gasto_operacion(v_gasto);
  PERFORM public.pagar_gasto_operacion(v_gasto, '2026-08-10', 400, 'spei', 'A');

  -- Julio: la deuda entera, sin caja.
  SELECT coalesce(sum(caja),0), coalesce(sum(pasivo),0)
  INTO v_caja, v_pasivo
  FROM public.vista_movimientos_financieros
  WHERE origen_id = v_gasto AND fecha >= '2026-07-01' AND fecha < '2026-08-01';
  IF v_caja <> 0 OR v_pasivo <> 1160 THEN
    RAISE EXCEPTION 'Caso 3: julio deberia ser caja 0 / pasivo 1160, y es % / %', v_caja, v_pasivo;
  END IF;

  -- Agosto: solo los 400 que se pagaron.
  SELECT coalesce(sum(caja),0), coalesce(sum(pasivo),0)
  INTO v_caja, v_pasivo
  FROM public.vista_movimientos_financieros
  WHERE origen_tabla = 'pagos_de_gasto' AND referencia = 'A'
    AND fecha >= '2026-08-01' AND fecha < '2026-09-01';
  IF v_caja <> -400 OR v_pasivo <> -400 THEN
    RAISE EXCEPTION 'Caso 3: agosto deberia ser caja -400 / pasivo -400, y es % / %', v_caja, v_pasivo;
  END IF;

  RAISE NOTICE 'Caso 3 OK';
END $$;

-- ===========================================================================
-- 4. El gasto capturado YA PAGADO no se parte: una sola fila, sin pasivo
-- ===========================================================================
-- Su asiento abona directo a 102 y nunca toca 205. Si la vista lo partiera en
-- devengo + pago, inventaria un pasivo que el libro jamas registro.
DO $$
DECLARE
  v_gasto  uuid;
  v_n      integer;
  v_caja   numeric;
  v_pasivo numeric;
BEGIN
  INSERT INTO public.gastos_operacion
    (fecha, cuenta_contable, proveedor, descripcion, moneda, tipo_cambio,
     subtotal, iva, total, total_mxn, metodo_pago, pagado_en)
  VALUES ('2026-07-08','602','ANTHROPIC','Claude','MXN',1,500,80,580,580,'tarjeta','2026-07-08')
  RETURNING id INTO v_gasto;

  PERFORM public.registrar_gasto_operacion(v_gasto);

  SELECT count(*) INTO v_n
  FROM public.vista_movimientos_financieros
  WHERE origen_id = v_gasto OR (origen_tabla = 'pagos_de_gasto'
        AND origen_id IN (SELECT id FROM public.pagos_de_gasto WHERE gasto_id = v_gasto));
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'Caso 4: el capturado ya pagado debe dar UNA fila, y da %', v_n;
  END IF;

  SELECT caja, pasivo INTO v_caja, v_pasivo
  FROM public.vista_movimientos_financieros WHERE origen_id = v_gasto;
  IF v_caja <> -580 OR v_pasivo <> 0 THEN
    RAISE EXCEPTION 'Caso 4: deberia ser caja -580 / pasivo 0, y es % / %', v_caja, v_pasivo;
  END IF;

  -- Y el libro coincide: cero movimiento en 205 para este gasto.
  SELECT coalesce(sum(l.debit) - sum(l.credit), 0) INTO v_caja
  FROM public.accounting_entry_lines l
  WHERE l.entry_id = (SELECT asiento_id FROM public.gastos_operacion WHERE id = v_gasto)
    AND l.account_code = '205';
  IF v_caja <> 0 THEN
    RAISE EXCEPTION 'Caso 4: el libro no toca 205 en este camino, y da %', v_caja;
  END IF;

  RAISE NOTICE 'Caso 4 OK';
END $$;

-- ===========================================================================
-- 5. Un borrador no se asoma, ni el devengo ni un pago
-- ===========================================================================
DO $$
DECLARE v_gasto uuid; v_n integer;
BEGIN
  INSERT INTO public.gastos_operacion
    (fecha, cuenta_contable, proveedor, descripcion, moneda, tipo_cambio,
     subtotal, iva, total, total_mxn)
  VALUES ('2026-07-09','601.02','BORRADOR','Hojas','MXN',1,100,16,116,116)
  RETURNING id INTO v_gasto;

  SELECT count(*) INTO v_n FROM public.vista_movimientos_financieros
  WHERE origen_id = v_gasto;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'Caso 5: un borrador no debe aparecer en la vista';
  END IF;
  RAISE NOTICE 'Caso 5 OK';
END $$;

-- ===========================================================================
-- 6. El invariante, ahora FILA POR FILA
-- ===========================================================================
-- Antes se comprobaba por categoria, que es mas flojo: dos filas mal repartidas
-- pueden compensarse dentro de la misma categoria y el total seguir cuadrando.
DO $$
DECLARE v_n integer;
BEGIN
  -- `traspaso` queda FUERA a proposito: un traspaso cambia de dueno el dinero
  -- sin moverlo del banco, asi que no entra en el invariante de caja. Las filas
  -- del monedero lo demuestran: traspaso 400, caja 0, pasivo 0, ingreso 0.
  SELECT count(*) INTO v_n
  FROM public.vista_movimientos_financieros
  WHERE abs(caja - (pasivo + ingreso)) > 0.01;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'Caso 6: % filas no cumplen caja = pasivo + ingreso', v_n;
  END IF;
  RAISE NOTICE 'Caso 6 OK';
END $$;

-- ===========================================================================
-- 7. Ninguna fila de la vista cae fuera de la fecha de su hecho
-- ===========================================================================
-- La afirmacion general de la que salio todo esto: la fecha de cada fila de
-- pago tiene que ser la del PAGO, no la del gasto.
DO $$
DECLARE v_n integer;
BEGIN
  SELECT count(*) INTO v_n
  FROM public.vista_movimientos_financieros v
  JOIN public.pagos_de_gasto p ON p.id = v.origen_id
  WHERE v.origen_tabla = 'pagos_de_gasto' AND v.fecha::date <> p.fecha;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'Caso 7: % filas de pago no llevan la fecha de su pago', v_n;
  END IF;

  SELECT count(*) INTO v_n
  FROM public.vista_movimientos_financieros v
  JOIN public.gastos_operacion g ON g.id = v.origen_id
  WHERE v.origen_tabla = 'gastos_operacion' AND v.fecha::date <> g.fecha;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'Caso 7: % filas de gasto no llevan la fecha de su gasto', v_n;
  END IF;
  RAISE NOTICE 'Caso 7 OK';
END $$;

-- ===========================================================================
-- 8. La vista y el libro dicen lo mismo, cuenta por cuenta
-- ===========================================================================
-- El chequeo que de verdad ata las dos mitades: la caja de la vista tiene que
-- ser el movimiento neto de 102 en el libro, y el pasivo el de 205.
DO $$
DECLARE
  v_caja_vista  numeric;
  v_caja_libro  numeric;
  v_pas_vista   numeric;
  v_pas_libro   numeric;
BEGIN
  SELECT coalesce(sum(caja),0), coalesce(sum(pasivo),0)
  INTO v_caja_vista, v_pas_vista
  FROM public.vista_movimientos_financieros
  WHERE origen_tabla IN ('gastos_operacion','pagos_de_gasto');

  SELECT coalesce(sum(l.credit) FILTER (WHERE l.account_code = '102'), 0)
           - coalesce(sum(l.debit) FILTER (WHERE l.account_code = '102'), 0),
         coalesce(sum(l.credit) FILTER (WHERE l.account_code = '205'), 0)
           - coalesce(sum(l.debit) FILTER (WHERE l.account_code = '205'), 0)
  INTO v_caja_libro, v_pas_libro
  FROM public.accounting_entries e
  JOIN public.accounting_entry_lines l ON l.entry_id = e.id
  WHERE e.source_type = 'gasto_operacion';

  IF abs(v_caja_vista - (-coalesce(v_caja_libro,0))) > 0.01 THEN
    RAISE EXCEPTION 'Caso 8: la caja de la vista (%) no coincide con 102 en el libro (%)',
      v_caja_vista, -coalesce(v_caja_libro,0);
  END IF;
  IF abs(v_pas_vista - coalesce(v_pas_libro,0)) > 0.01 THEN
    RAISE EXCEPTION 'Caso 8: el pasivo de la vista (%) no coincide con 205 en el libro (%)',
      v_pas_vista, coalesce(v_pas_libro,0);
  END IF;
  RAISE NOTICE 'Caso 8 OK';
END $$;

ROLLBACK;

\echo 'La fecha del pago de un gasto: 8/8 casos OK'
