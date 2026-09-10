-- Prueba de `20260910210000_captura_de_gastos_de_operacion.sql`.
--
-- QUE SE PRUEBA, y sobre todo POR QUE
--
-- Esta migracion mete dinero al sistema contable desde una pantalla donde
-- escribe una persona. Los tres riesgos son distintos y cada uno tiene su
-- bloque de casos:
--
--   RIESGO 1 -- que el asiento no cuadre. `total_mxn` es EDITABLE a proposito
--   (el banco aplica su propio tipo de cambio y casi nunca coincide con el del
--   CFDI). Si el asiento derivara el IVA como `iva * tipo_cambio`, en cuanto
--   alguien ajustara el total al importe real del banco el asiento quedaria
--   descuadrado por la diferencia. Los casos 5 y 6 lo comprueban justo con un
--   total editado.
--
--   RIESGO 2 -- que se cargue a la cuenta equivocada. La llave foranea acepta
--   CUALQUIER codigo del catalogo, incluido '102' (Bancos). Un gasto cargado a
--   Bancos duplicaria el activo y la vista seguiria llamandolo egreso, porque
--   el bloque 19 no mira la cuenta. El caso 3 lo prueba con '102' y con una
--   cuenta desactivada.
--
--   RIESGO 3 -- que lo registre quien no debe. La funcion es SECURITY DEFINER,
--   asi que se salta las RLS por diseno y la autorizacion tiene que estar
--   escrita dentro. El caso 4 prueba a los tres: quien puede, un admin sin el
--   permiso, y una contable BLOQUEADA que ademas es super admin -- ese ultimo
--   caso existe porque las politicas viejas de contabilidad consultan `users`
--   directo y no miran `is_active`.
--
--   psql -f scripts/test-gastos-operacion.sql

\set ON_ERROR_STOP on
\set QUIET on

\ir fixture-movimientos.sql

\ir ../supabase/migrations/20260910080000_vista_movimientos_financieros.sql
\ir ../supabase/migrations/20260910200000_corregir_membresia_y_pasivo_por_comisiones.sql
\ir ../supabase/migrations/20260910210000_captura_de_gastos_de_operacion.sql
-- Y el arreglo del tipo de cambio de relleno de los recurrentes.
\ir ../supabase/migrations/20260910220000_tipo_de_cambio_pendiente_en_recurrentes.sql

-- La contable autorizada. Se le da el permiso que la migracion acaba de crear.
INSERT INTO admin_permissions (user_id, can_view_accounting)
VALUES ('c0000000-0000-0000-0000-0000000000a1', true),
       ('c0000000-0000-0000-0000-0000000000a2', true);
UPDATE admin_permissions SET can_manage_expenses = true
 WHERE user_id = 'c0000000-0000-0000-0000-0000000000a1';

-- Se opera como la contable autorizada salvo donde el caso diga otra cosa.
DO $$ BEGIN PERFORM set_config('prueba.usuario','c0000000-0000-0000-0000-0000000000a1',false); END $$;

\echo '=== Caso 1: en pesos el tipo de cambio solo puede ser 1 ==='
DO $$
DECLARE v_paso boolean := false;
BEGIN
  BEGIN
    INSERT INTO gastos_operacion (fecha, cuenta_contable, proveedor, descripcion,
      moneda, tipo_cambio, subtotal, iva, total, total_mxn)
    VALUES ('2026-09-01','601.01','Telcel','Internet','MXN',17,100,16,116,1972);
    v_paso := true;
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF v_paso THEN
    RAISE EXCEPTION 'FALLO 1: se capturaron pesos con tipo de cambio 17. Eso multiplica el gasto por 17 sin que nadie lo note.';
  END IF;
  RAISE NOTICE '  MXN con tipo de cambio 17: rechazado. OK';
END $$;

\echo '=== Caso 2: el total tiene que ser subtotal + IVA ==='
DO $$
DECLARE v_paso boolean := false; v_id uuid;
BEGIN
  BEGIN
    INSERT INTO gastos_operacion (fecha, cuenta_contable, proveedor, descripcion,
      subtotal, iva, total, total_mxn)
    VALUES ('2026-09-01','601.01','Telcel','Internet',100,16,999,999);
    v_paso := true;
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF v_paso THEN
    RAISE EXCEPTION 'FALLO 2: se acepto un total que no es la suma de sus partes.';
  END IF;

  -- Pero un centavo de diferencia SI se tolera: hay proveedores que redondean
  -- asi y rechazarlos obligaria a falsear la captura.
  INSERT INTO gastos_operacion (fecha, cuenta_contable, proveedor, descripcion,
    subtotal, iva, total, total_mxn)
  VALUES ('2026-09-01','601.01','Redondeo SA','Servicio',100,16,116.01,116.01)
  RETURNING id INTO v_id;
  DELETE FROM gastos_operacion WHERE id = v_id;

  RAISE NOTICE '  total que no cuadra: rechazado; un centavo de redondeo: aceptado. OK';
END $$;

\echo '=== Caso 3: RIESGO 2 -- la cuenta tiene que ser de gasto y estar activa ==='
DO $$
DECLARE v_paso boolean;
BEGIN
  -- '102' es Bancos. Existe en el catalogo, asi que la llave foranea la deja
  -- pasar; lo que la frena es el trigger.
  v_paso := false;
  BEGIN
    INSERT INTO gastos_operacion (fecha, cuenta_contable, proveedor, descripcion,
      subtotal, iva, total, total_mxn)
    VALUES ('2026-09-01','102','Telcel','Internet',100,16,116,116);
    v_paso := true;
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF v_paso THEN
    RAISE EXCEPTION 'FALLO 3: se cargo un gasto a Bancos. Eso sube el activo y la vista lo seguiria llamando egreso.';
  END IF;

  -- '604' es de gasto pero esta dada de baja.
  v_paso := false;
  BEGIN
    INSERT INTO gastos_operacion (fecha, cuenta_contable, proveedor, descripcion,
      subtotal, iva, total, total_mxn)
    VALUES ('2026-09-01','604','Telcel','Internet',100,16,116,116);
    v_paso := true;
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF v_paso THEN
    RAISE EXCEPTION 'FALLO 3: se uso una cuenta inactiva.';
  END IF;

  RAISE NOTICE '  cuenta de banco y cuenta inactiva: las dos rechazadas. OK';
END $$;

\echo '=== Caso 4: RIESGO 3 -- quien puede registrar y quien no ==='
DO $$
DECLARE v_gasto uuid; v_paso boolean;
BEGIN
  INSERT INTO gastos_operacion (fecha, cuenta_contable, proveedor, descripcion,
    subtotal, iva, total, total_mxn, metodo_pago, pagado_en)
  VALUES ('2026-09-01','601.01','Telcel','Internet de oficina',
          344.83,55.17,400,400,'spei','2026-09-01')
  RETURNING id INTO v_gasto;

  -- Un admin CON can_view_accounting pero SIN can_manage_expenses.
  PERFORM set_config('prueba.usuario','c0000000-0000-0000-0000-0000000000a2',false);
  v_paso := false;
  BEGIN
    PERFORM registrar_gasto_operacion(v_gasto);
    v_paso := true;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  IF v_paso THEN
    RAISE EXCEPTION 'FALLO 4: un admin sin can_manage_expenses registro un gasto.';
  END IF;

  -- Una contable SUPER ADMIN pero bloqueada. Este es el caso que se cuela si
  -- la autorizacion consulta `users` directo en vez de `current_user_has_role`.
  PERFORM set_config('prueba.usuario','c0000000-0000-0000-0000-0000000000a3',false);
  v_paso := false;
  BEGIN
    PERFORM registrar_gasto_operacion(v_gasto);
    v_paso := true;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  IF v_paso THEN
    RAISE EXCEPTION 'FALLO 4: una usuaria BLOQUEADA registro un gasto por ser super admin. Bloquear tiene que ganarle a cualquier permiso.';
  END IF;

  -- Y la autorizada si.
  PERFORM set_config('prueba.usuario','c0000000-0000-0000-0000-0000000000a1',false);
  IF registrar_gasto_operacion(v_gasto) IS NULL THEN
    RAISE EXCEPTION 'FALLO 4: la contable autorizada no pudo registrar.';
  END IF;

  RAISE NOTICE '  admin sin permiso: no. Bloqueada aunque sea super admin: no. Autorizada: si. OK';
END $$;

\echo '=== Caso 5: el asiento de un gasto pagado cuadra y toca Bancos ==='
DO $$
DECLARE v record;
BEGIN
  SELECT sum(l.debit) AS debe, sum(l.credit) AS haber,
         sum(l.debit) FILTER (WHERE l.account_code = '601.01') AS gasto,
         sum(l.debit) FILTER (WHERE l.account_code = '108')    AS iva,
         sum(l.credit) FILTER (WHERE l.account_code = '102')   AS bancos,
         sum(l.credit) FILTER (WHERE l.account_code = '205')   AS acreedores
    INTO v
    FROM accounting_entry_lines l
    JOIN accounting_entries e ON e.id = l.entry_id
   WHERE e.source_type = 'gasto_operacion';

  IF v.debe <> v.haber THEN
    RAISE EXCEPTION 'FALLO 5: el asiento no cuadra: debe=% haber=%', v.debe, v.haber;
  END IF;
  IF v.gasto <> 344.83 OR v.iva <> 55.17 OR v.bancos <> 400 OR v.acreedores IS NOT NULL THEN
    RAISE EXCEPTION 'FALLO 5: gasto=% iva=% bancos=% acreedores=% (esperado 344.83/55.17/400/nada)',
      v.gasto, v.iva, v.bancos, v.acreedores;
  END IF;
  RAISE NOTICE '  400 pagados -> 344.83 a gasto, 55.17 a IVA acreditable, 400 al haber de Bancos. OK';
END $$;

\echo '=== Caso 6: RIESGO 1 -- con el total en pesos editado el asiento sigue cuadrando ==='
DO $$
DECLARE v_gasto uuid; v_asiento uuid; v record;
BEGIN
  -- 13 USD a 20.00 darian 260, pero el banco cobro 264.55 con su propio tipo
  -- de cambio. Se captura lo que de verdad salio. El gasto trae IVA para que
  -- el reparto proporcional tenga algo que repartir.
  INSERT INTO gastos_operacion (fecha, cuenta_contable, proveedor, descripcion,
    moneda, tipo_cambio, subtotal, iva, total, total_mxn, metodo_pago, pagado_en)
  VALUES ('2026-09-02','602','Proveedor USD','Licencia',
          'USD',20,100,16,116,264.55,'tarjeta','2026-09-02')
  RETURNING id INTO v_gasto;

  v_asiento := registrar_gasto_operacion(v_gasto);

  SELECT sum(debit) AS debe, sum(credit) AS haber,
         sum(debit) FILTER (WHERE account_code = '108') AS iva,
         sum(debit) FILTER (WHERE account_code = '602') AS gasto
    INTO v FROM accounting_entry_lines WHERE entry_id = v_asiento;

  IF v.debe <> v.haber OR v.haber <> 264.55 THEN
    RAISE EXCEPTION 'FALLO 6: debe=% haber=% (los dos tenian que ser 264.55). Derivar el IVA de `iva * tipo_cambio` da justo este descuadre.',
      v.debe, v.haber;
  END IF;
  -- 264.55 * (16/116) = 36.49. Si se hubiera hecho 16 * 20 = 320, el asiento
  -- estaria descuadrado por 4.55 y ademas el IVA acreditable seria falso.
  IF v.iva <> 36.49 OR v.gasto <> 228.06 THEN
    RAISE EXCEPTION 'FALLO 6: iva=% gasto=% (esperado 36.49/228.06)', v.iva, v.gasto;
  END IF;
  RAISE NOTICE '  total editado a 264.55 -> IVA 36.49 y gasto 228.06, asiento cuadrado. OK';
END $$;

\echo '=== Caso 7: registrar dos veces no crea dos asientos ==='
DO $$
DECLARE v_gasto uuid; v_uno uuid; v_dos uuid; v_asientos int; v_lineas int;
BEGIN
  INSERT INTO gastos_operacion (fecha, cuenta_contable, proveedor, descripcion,
    subtotal, iva, total, total_mxn)
  VALUES ('2026-09-03','601.02','Papeleria','Hojas',100,16,116,116)
  RETURNING id INTO v_gasto;

  v_uno := registrar_gasto_operacion(v_gasto);
  v_dos := registrar_gasto_operacion(v_gasto);

  IF v_uno IS DISTINCT FROM v_dos THEN
    RAISE EXCEPTION 'FALLO 7: la segunda llamada devolvio otro asiento (% vs %). Un doble clic duplicaria el gasto.', v_uno, v_dos;
  END IF;
  SELECT count(*) INTO v_asientos FROM accounting_entries WHERE source_id = v_gasto;
  SELECT count(*) INTO v_lineas   FROM accounting_entry_lines WHERE entry_id = v_uno;
  IF v_asientos <> 1 THEN
    RAISE EXCEPTION 'FALLO 7: % asientos para el mismo gasto.', v_asientos;
  END IF;
  IF v_lineas <> 3 THEN
    RAISE EXCEPTION 'FALLO 7: % lineas (esperado 3: gasto, IVA y acreedor).', v_lineas;
  END IF;
  RAISE NOTICE '  segunda llamada: mismo asiento, 3 lineas, sin duplicar. OK';
END $$;

\echo '=== Caso 8: sin IVA no se toca la cuenta de IVA, y sin pagar va a acreedores ==='
DO $$
DECLARE v_gasto uuid; v_asiento uuid; v record;
BEGIN
  -- Anthropic factura en USD y no traslada IVA. Es el caso que motivo que el
  -- IVA fuera opcional.
  INSERT INTO gastos_operacion (fecha, cuenta_contable, proveedor, descripcion,
    moneda, tipo_cambio, subtotal, iva, total, total_mxn)
  VALUES ('2026-09-04','602','Anthropic','Claude','USD',20,13,0,13,260)
  RETURNING id INTO v_gasto;

  v_asiento := registrar_gasto_operacion(v_gasto);

  SELECT count(*) AS lineas,
         count(*) FILTER (WHERE account_code = '108') AS iva,
         sum(credit) FILTER (WHERE account_code = '205') AS acreedores,
         sum(credit) FILTER (WHERE account_code = '102') AS bancos
    INTO v FROM accounting_entry_lines WHERE entry_id = v_asiento;

  IF v.iva <> 0 THEN
    RAISE EXCEPTION 'FALLO 8: se acredito IVA de un proveedor que no lo traslada. Eso es IVA acreditable inventado.';
  END IF;
  IF v.lineas <> 2 THEN
    RAISE EXCEPTION 'FALLO 8: % lineas (esperado 2: gasto y acreedor).', v.lineas;
  END IF;
  IF v.acreedores <> 260 OR v.bancos IS NOT NULL THEN
    RAISE EXCEPTION 'FALLO 8: acreedores=% bancos=% -- sin `pagado_en` no pudo salir del banco.', v.acreedores, v.bancos;
  END IF;
  RAISE NOTICE '  sin IVA: 2 lineas. Sin pagar: al haber de acreedores, no de Bancos. OK';
END $$;

\echo '=== Caso 9: un gasto cancelado no se registra, y un CFDI no se captura dos veces ==='
DO $$
DECLARE v_gasto uuid; v_paso boolean;
BEGIN
  INSERT INTO gastos_operacion (fecha, cuenta_contable, proveedor, descripcion,
    subtotal, iva, total, total_mxn, estado, cfdi_uuid)
  VALUES ('2026-09-05','601.01','Luz y Fuerza','Recibo',100,16,116,116,'cancelado',
          '11111111-2222-3333-4444-555555555555')
  RETURNING id INTO v_gasto;

  v_paso := false;
  BEGIN
    PERFORM registrar_gasto_operacion(v_gasto);
    v_paso := true;
  EXCEPTION WHEN others THEN NULL;
  END;
  IF v_paso THEN
    RAISE EXCEPTION 'FALLO 9: se registro un gasto cancelado.';
  END IF;

  -- El indice unico es PARCIAL sobre cfdi_uuid: aunque este cancelado, ese
  -- folio ya se uso. Facturar dos veces el mismo CFDI es un problema fiscal,
  -- no solo contable.
  v_paso := false;
  BEGIN
    INSERT INTO gastos_operacion (fecha, cuenta_contable, proveedor, descripcion,
      subtotal, iva, total, total_mxn, cfdi_uuid)
    VALUES ('2026-09-06','601.01','Luz y Fuerza','Recibo otra vez',100,16,116,116,
            '11111111-2222-3333-4444-555555555555');
    v_paso := true;
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  IF v_paso THEN
    RAISE EXCEPTION 'FALLO 9: el mismo CFDI se capturo dos veces.';
  END IF;

  RAISE NOTICE '  cancelado no se registra; CFDI repetido rechazado. OK';
END $$;

\echo '=== Caso 10: los recurrentes generan BORRADORES, y solo una vez por mes ==='
DO $$
DECLARE v_primera int; v_segunda int; v_estados text[]; v_filas int;
BEGIN
  INSERT INTO gastos_recurrentes (nombre, cuenta_contable, proveedor, descripcion,
    subtotal_estimado, iva_estimado, dia_del_mes)
  VALUES ('Telcel oficina','601.01','Telcel','Internet de oficina',344.83,55.17,5),
         ('Claude',        '602',   'Anthropic','Suscripcion',       260,   0,     1);

  v_primera := generar_borradores_de_gastos_recurrentes('2026-10');
  IF v_primera <> 2 THEN
    RAISE EXCEPTION 'FALLO 10: se crearon % borradores (esperado 2).', v_primera;
  END IF;

  -- Ninguno queda registrado. Un gasto que se asienta solo con el importe del
  -- mes pasado es peor que no tenerlo, porque parece cierto.
  SELECT array_agg(DISTINCT estado) INTO v_estados
    FROM gastos_operacion WHERE periodo = '2026-10';
  IF v_estados IS DISTINCT FROM ARRAY['borrador'] THEN
    RAISE EXCEPTION 'FALLO 10: los recurrentes quedaron en % en vez de solo borrador.', v_estados;
  END IF;

  -- Correrlo dos veces el mismo mes no duplica nada.
  v_segunda := generar_borradores_de_gastos_recurrentes('2026-10');
  SELECT count(*) INTO v_filas FROM gastos_operacion WHERE periodo = '2026-10';
  IF v_segunda <> 0 OR v_filas <> 2 THEN
    RAISE EXCEPTION 'FALLO 10: la segunda corrida creo % y quedaron % filas.', v_segunda, v_filas;
  END IF;

  -- Y un periodo mal escrito no pasa.
  BEGIN
    PERFORM generar_borradores_de_gastos_recurrentes('octubre');
    RAISE EXCEPTION 'FALLO 10: se acepto el periodo "octubre".';
  EXCEPTION WHEN raise_exception THEN
    IF sqlerrm LIKE 'FALLO 10%' THEN RAISE; END IF;
  END;

  RAISE NOTICE '  2 borradores, ninguno registrado, la segunda corrida no duplica. OK';
END $$;

\echo '=== Caso 12: un recurrente en USD no se asienta con el tipo de cambio de relleno ==='
DO $$
DECLARE v_plantilla uuid; v_borrador record; v_paso boolean; v_asiento uuid; v_debe numeric;
BEGIN
  -- ESTE CASO EXISTE POR UN FALLO REPRODUCIDO, no por precaucion.
  --
  -- El generador inserta `tipo_cambio = 1` siempre, sin mirar la moneda. Con la
  -- plantilla de Claude, que es en USD, el borrador salia con 260 USD a tipo de
  -- cambio 1 y `registrar_gasto_operacion` lo asentaba tal cual:
  --
  --     602  Anthropic — Suscripcion   debe 260.00
  --     205  Por pagar a Anthropic                haber 260.00
  --
  -- 260 pesos por un gasto de 260 dolares. A 20 por dolar el gasto real son
  -- 5,200: el asiento subestimaba el egreso VEINTE VECES. Y cuadraba, asi que
  -- ni el invariante de la vista ni el debe/haber lo cazaban. Los numeros que
  -- cuadran y son falsos hay que prohibirlos, no sumarlos.
  INSERT INTO gastos_recurrentes (nombre, cuenta_contable, proveedor, descripcion,
    moneda, subtotal_estimado, iva_estimado, dia_del_mes)
  VALUES ('Claude USD','602','Anthropic','Suscripcion','USD',260,0,1)
  RETURNING id INTO v_plantilla;

  PERFORM generar_borradores_de_gastos_recurrentes('2026-11');

  SELECT * INTO v_borrador FROM gastos_operacion
   WHERE recurrente_id = v_plantilla AND periodo = '2026-11';

  -- El borrador SI nace con el relleno: `tipo_cambio` no admite 0 ni NULL, y el
  -- tipo de cambio del mes que viene no se sabe hoy. Eso esta bien.
  IF v_borrador.tipo_cambio <> 1 OR v_borrador.moneda <> 'USD' THEN
    RAISE EXCEPTION 'FALLO 12: el borrador nacio con moneda=% tc=% (se esperaba USD y el relleno 1).',
      v_borrador.moneda, v_borrador.tipo_cambio;
  END IF;
  -- Pero lo dice.
  IF coalesce(v_borrador.notas,'') NOT LIKE '%tipo de cambio%' THEN
    RAISE EXCEPTION 'FALLO 12: el borrador en moneda extranjera no avisa que falta el tipo de cambio. Notas: %',
      v_borrador.notas;
  END IF;

  -- Y NO se registra asi. Se comprueba el MENSAJE, no solo que falle: el CHECK
  -- de la tabla ya lo impide, asi que sin mirar el texto una mutacion que
  -- quitara el RAISE de la funcion sobrevivia -- comprobado, sobrevivio. Y un
  -- 23514 con el nombre de la restriccion no le dice a nadie que hacer.
  v_paso := false;
  BEGIN
    PERFORM registrar_gasto_operacion(v_borrador.id);
    v_paso := true;
  EXCEPTION WHEN check_violation THEN
    IF sqlerrm NOT LIKE '%Captura el tipo de cambio%' THEN
      RAISE EXCEPTION 'FALLO 12: rebota, pero con un mensaje que no dice que hacer: "%"', sqlerrm;
    END IF;
  END;
  IF v_paso THEN
    RAISE EXCEPTION 'FALLO 12: se asentaron 260 USD como 260 MXN. El gasto real es veinte veces mayor.';
  END IF;

  -- Ni por la puerta de atras: el CHECK tambien frena un UPDATE directo, que es
  -- lo que haria alguien desde el editor de SQL o desde una pantalla futura.
  v_paso := false;
  BEGIN
    UPDATE gastos_operacion SET estado = 'registrado',
           asiento_id = (SELECT id FROM accounting_entries LIMIT 1)
     WHERE id = v_borrador.id;
    v_paso := true;
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF v_paso THEN
    RAISE EXCEPTION 'FALLO 12: un UPDATE directo registro el gasto con el tipo de cambio de relleno.';
  END IF;

  -- Con el tipo de cambio del mes capturado, se registra normal y el asiento
  -- refleja los pesos de verdad.
  UPDATE gastos_operacion
     SET tipo_cambio = 20, total_mxn = 5200
   WHERE id = v_borrador.id;
  v_asiento := registrar_gasto_operacion(v_borrador.id);

  SELECT sum(debit) INTO v_debe FROM accounting_entry_lines WHERE entry_id = v_asiento;
  IF v_debe <> 5200 THEN
    RAISE EXCEPTION 'FALLO 12: el asiento quedo en % y debia ser 5200.', v_debe;
  END IF;

  RAISE NOTICE '  borrador USD nace con relleno y lo avisa; no se asienta hasta capturar el TC; con TC 20 asienta 5200. OK';
END $$;

\echo '=== Caso 11: las RLS aplican de verdad, no solo estan encendidas ==='
DO $$
DECLARE v_gastos boolean; v_recurrentes boolean;
BEGIN
  SELECT relrowsecurity INTO v_gastos      FROM pg_class WHERE oid = 'public.gastos_operacion'::regclass;
  SELECT relrowsecurity INTO v_recurrentes FROM pg_class WHERE oid = 'public.gastos_recurrentes'::regclass;
  IF NOT v_gastos OR NOT v_recurrentes THEN
    RAISE EXCEPTION 'FALLO 11: RLS apagada (gastos=%, recurrentes=%).', v_gastos, v_recurrentes;
  END IF;
END $$;

-- Y ahora de verdad, como `authenticated`. Comprobar que la RLS esta encendida
-- no demuestra que la politica diga lo correcto.
SET ROLE authenticated;
DO $$ BEGIN PERFORM set_config('prueba.usuario','c0000000-0000-0000-0000-0000000000a2',false); END $$;

DO $$
DECLARE v_paso boolean := false;
BEGIN
  BEGIN
    INSERT INTO gastos_operacion (fecha, cuenta_contable, proveedor, descripcion,
      subtotal, iva, total, total_mxn)
    VALUES ('2026-09-07','601.01','Coladero','Por la puerta de atras',100,16,116,116);
    v_paso := true;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  IF v_paso THEN
    RAISE EXCEPTION 'FALLO 11: un admin sin can_manage_expenses inserto un gasto saltandose la funcion.';
  END IF;
  RAISE NOTICE '  como authenticated sin permiso: no puede insertar ni por la puerta de atras. OK';
END $$;

RESET ROLE;

\echo ''
\echo 'Captura de gastos de operacion: 12/12 casos OK'
