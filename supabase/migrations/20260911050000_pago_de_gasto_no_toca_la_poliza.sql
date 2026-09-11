-- ============================================================================
-- El pago de un gasto no puede tocar su propia poliza
-- ============================================================================
--
-- EL ERROR EN PANTALLA
--
--   «Una póliza publicada es inmutable; genere una reversa»
--
-- Sale al pulsar «Registrar pago». No es un permiso ni un dato mal capturado:
-- es un defecto de `20260911040000`, que despues de insertar el asiento —con
-- `is_posted = true`— lo volvia a tocar para escribirle el `source_id`:
--
--     INSERT INTO accounting_entries (... source_id ...) VALUES (... gen_random_uuid() ...)
--     INSERT INTO pagos_de_gasto (...) RETURNING id INTO v_pago;
--     UPDATE accounting_entries SET source_id = v_pago WHERE id = v_asiento;  -- <-- aqui
--
-- Ese UPDATE choca contra `trg_validate_posted_accounting_entry`, la misma
-- regla de inmutabilidad que la cabecera de aquella migracion citaba como
-- argumento para no editar el asiento al pagar. La funcion se tropezo con el
-- hallazgo que la justificaba.
--
-- LA CORRECCION
--
-- El UPDATE existia solo porque el id del pago «no existe hasta despues del
-- INSERT». Eso es falso: `gen_random_uuid()` se puede pedir antes y usar en
-- los dos INSERT. El uuid se genera primero, entra como `source_id` del
-- asiento, y despues se escribe explicitamente como `id` del pago. Queda el
-- mismo par (asiento, pago) apuntandose mutuamente, con un INSERT menos que
-- corregir y CERO escrituras sobre una poliza publicada.
--
-- POR QUE LA PRUEBA NO LO CAZO
--
-- `scripts/fixture-movimientos.sql` creaba `accounting_entries` como una tabla
-- pelona, sin los triggers de `20260910000000`. Los diez casos de
-- `test-pagar-gasto.sql` pasaban porque en el fixture ese UPDATE era legal.
-- Esta migracion viene acompañada de los triggers en el fixture: sin eso, el
-- siguiente UPDATE a una poliza publicada volveria a llegar hasta produccion.
--
-- No hay datos que reparar: la excepcion aborta la transaccion completa, asi
-- que ningun pago ni asiento a medias quedo escrito. Verificado en produccion
-- antes de escribir esto (0 filas en `pagos_de_gasto`, 0 asientos huerfanos).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.pagar_gasto_operacion(
  p_gasto_id   uuid,
  p_fecha      date,
  p_monto_mxn  numeric,
  p_metodo     text DEFAULT NULL,
  p_referencia text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_g        record;
  v_pagado   numeric;
  v_saldo    numeric;
  v_asiento  uuid;
  v_numero   text;
  v_pago     uuid;
BEGIN
  IF NOT public.puede_gestionar_gastos() THEN
    RAISE EXCEPTION 'No tienes permiso para registrar pagos de gastos.'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_g FROM public.gastos_operacion WHERE id = p_gasto_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El gasto no existe.' USING ERRCODE = 'P0002';
  END IF;

  IF v_g.estado = 'borrador' THEN
    RAISE EXCEPTION 'Registra el gasto antes de pagarlo: un borrador todavia no genero la deuda.';
  END IF;
  IF v_g.estado = 'cancelado' THEN
    RAISE EXCEPTION 'El gasto esta cancelado y no se puede pagar.';
  END IF;

  IF p_monto_mxn IS NULL OR p_monto_mxn <= 0 THEN
    RAISE EXCEPTION 'El monto del pago tiene que ser mayor que cero.';
  END IF;

  IF p_fecha < v_g.fecha THEN
    RAISE EXCEPTION 'El pago (%) no puede ser anterior al gasto (%).', p_fecha, v_g.fecha;
  END IF;

  SELECT coalesce(sum(monto_mxn), 0) INTO v_pagado
  FROM public.pagos_de_gasto WHERE gasto_id = p_gasto_id;

  v_saldo := round(v_g.total_mxn - v_pagado, 2);

  IF v_saldo <= 0 THEN
    RAISE EXCEPTION 'Este gasto ya esta pagado por completo.';
  END IF;

  -- Un sobrepago dejaria 205 en deudor, o sea diciendo que el proveedor te debe
  -- a ti. Se rechaza con el saldo a la vista para que el usuario corrija.
  IF round(p_monto_mxn, 2) > v_saldo THEN
    RAISE EXCEPTION 'El pago (%) excede el saldo pendiente (%).',
      round(p_monto_mxn, 2), v_saldo;
  END IF;

  -- El id del pago se genera ANTES de los dos INSERT. Asi el asiento nace ya
  -- con su `source_id` definitivo y nunca hay que volver a tocarlo: una poliza
  -- publicada es inmutable, y cualquier UPDATE posterior aborta la operacion.
  v_pago := gen_random_uuid();

  v_numero := public.generate_entry_number(
                'egreso',
                extract(year  FROM p_fecha)::int,
                extract(month FROM p_fecha)::int);

  INSERT INTO public.accounting_entries (
    entry_number, entry_type, entry_date, period_year, period_month,
    description, source_type, source_id, is_posted, posted_at
  ) VALUES (
    v_numero, 'egreso', p_fecha,
    extract(year FROM p_fecha)::int, extract(month FROM p_fecha)::int,
    'Pago a ' || v_g.proveedor || ' — ' || v_g.descripcion,
    'gasto_operacion',
    -- El source_id es el ID DEL PAGO, no el del gasto: el gasto ya uso su
    -- pareja (gasto_operacion, gasto_id) en el asiento de devengo, y repetirla
    -- chocaria con la idempotencia. Con parcialidades ademas hay varios pagos
    -- por gasto, asi que la unica llave estable es la del pago.
    v_pago,
    true, now()
  ) RETURNING id INTO v_asiento;

  INSERT INTO public.accounting_entry_lines (
    entry_id, line_number, account_code, description, debit, credit
  ) VALUES
    (v_asiento, 1, '205',
     'Pago a ' || v_g.proveedor, round(p_monto_mxn, 2), 0),
    (v_asiento, 2, '102',
     'Salida de banco — ' || coalesce(p_metodo, 'sin metodo')
       || coalesce(' ref ' || p_referencia, ''), 0, round(p_monto_mxn, 2));

  INSERT INTO public.pagos_de_gasto (
    id, gasto_id, fecha, monto_mxn, metodo_pago, referencia, asiento_id
  ) VALUES (
    v_pago, p_gasto_id, p_fecha, round(p_monto_mxn, 2), p_metodo, p_referencia, v_asiento
  );

  -- `pagado_en` solo cuando el saldo llega a cero. Si queda parcial, el gasto
  -- sigue apareciendo como deuda por su resto, que es lo correcto.
  IF round(v_pagado + p_monto_mxn, 2) >= round(v_g.total_mxn, 2) THEN
    UPDATE public.gastos_operacion
       SET pagado_en = p_fecha,
           metodo_pago = coalesce(metodo_pago, p_metodo),
           updated_at = now()
     WHERE id = p_gasto_id;
  END IF;

  RETURN v_pago;
END;
$$;

COMMENT ON FUNCTION public.pagar_gasto_operacion(uuid, date, numeric, text, text) IS
  'Registra un pago (total o parcial) de un gasto de operacion y su asiento 205/102. El uuid del pago se genera antes de insertar el asiento para que nunca haya que actualizar una poliza publicada. Escribe gastos_operacion.pagado_en cuando la suma de pagos alcanza el total.';

REVOKE ALL ON FUNCTION public.pagar_gasto_operacion(uuid, date, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pagar_gasto_operacion(uuid, date, numeric, text, text) TO authenticated;
