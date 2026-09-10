-- El tipo de cambio que nadie eligio.
--
-- ============================================================================
-- EL FALLO, REPRODUCIDO
-- ============================================================================
--
-- `generar_borradores_de_gastos_recurrentes` inserta los borradores con
-- `tipo_cambio = 1` SIEMPRE, sin mirar la moneda de la plantilla. Con una
-- plantilla en pesos eso es correcto. Con la de Claude, que factura en USD, el
-- borrador sale asi:
--
--     proveedor | moneda | tipo_cambio | total  | total_mxn | estado
--     Anthropic | USD    |    1.000000 | 260.00 |    260.00 | borrador
--
-- Y `registrar_gasto_operacion` lo asienta sin quejarse:
--
--     602  Anthropic — Suscripcion   debe 260.00
--     205  Por pagar a Anthropic                haber 260.00
--
-- 260 pesos por un gasto de 260 dolares. A un tipo de cambio de 20 el gasto
-- real son 5,200: el asiento subestima el egreso VEINTE VECES.
--
-- Lo peor es que CUADRA. Debe igual a haber, y el invariante
-- `activo = pasivo + ingreso` de la vista tambien se cumple. Es exactamente la
-- misma clase de error que la membresia marcada como pasivo: balanceado y mal.
-- Un numero que cuadra y es falso no lo caza ninguna suma; hay que prohibirlo.
--
-- ============================================================================
-- POR QUE NO SE ARREGLA EN EL GENERADOR
-- ============================================================================
--
-- La tentacion es que el generador ponga el tipo de cambio bueno. No puede: el
-- tipo de cambio del mes que viene no se sabe hoy, y la plantilla no lo guarda
-- a proposito -- fue decision de Axel, porque cambia cada mes. Y `tipo_cambio`
-- no admite 0 ni NULL (hay un CHECK de que sea positivo), asi que el borrador
-- TIENE que llevar un valor de relleno.
--
-- Entonces el borrador puede seguir naciendo con el relleno; lo que no puede es
-- REGISTRARSE con el. La regla queda donde importa: al momento de asentar.
--
-- ============================================================================
-- POR QUE VA EN UNA MIGRACION APARTE
-- ============================================================================
--
-- Lo natural seria corregir 20260910240000, que es de hace un rato. Cuando esto
-- se escribio no constaba que siguiera sin aplicar, y editar en su sitio una
-- migracion ya corrida significa que el arreglo NO se aplica nunca: el registro
-- de migraciones la da por hecha y el gasto de veinte veces menos se va a
-- produccion en silencio.
--
-- Despues se supo que ninguna de las dos estaba aplicada: el `db push` de Axel
-- aborto antes de tocar nada, por otra razon (una migracion de disputas
-- aplicada en produccion que su copia local todavia no tenia). Aun asi se
-- quedan separadas a proposito: fundirlas borraria del historial que el fallo
-- existio y como se encontro, que es justo lo que hace falta recordar la
-- proxima vez que un numero cuadre y sea falso.

-- ---------------------------------------------------------------------------
-- 1. La garantia dura
-- ---------------------------------------------------------------------------
-- Va como CHECK y no solo dentro de la funcion porque un UPDATE directo desde
-- la pantalla o desde el SQL editor tambien tiene que rebotar. Solo aplica a
-- los REGISTRADOS: el borrador puede llevar el relleno mientras alguien lo
-- corrige, que es justo para lo que existe el estado borrador.
--
-- No hay moneda en el mundo que valga exactamente un peso, asi que "no es MXN
-- y el tipo de cambio es 1" no tiene ningun caso legitimo que este CHECK
-- estorbe.
ALTER TABLE public.gastos_operacion
  DROP CONSTRAINT IF EXISTS gastos_registrado_con_tipo_de_cambio_real;

ALTER TABLE public.gastos_operacion
  ADD CONSTRAINT gastos_registrado_con_tipo_de_cambio_real
  CHECK (estado <> 'registrado' OR moneda = 'MXN' OR tipo_cambio <> 1);

COMMENT ON CONSTRAINT gastos_registrado_con_tipo_de_cambio_real ON public.gastos_operacion IS
  'Un gasto en moneda extranjera no se registra con tipo de cambio 1. Los '
  'borradores de los recurrentes nacen con ese relleno porque el tipo de '
  'cambio del mes no se sabe al generarlos; registrarlo asi asentaria dolares '
  'como si fueran pesos.';

-- ---------------------------------------------------------------------------
-- 2. El mensaje legible
-- ---------------------------------------------------------------------------
-- El CHECK ya impide el dano, pero un 23514 con el nombre de la restriccion no
-- le dice a nadie que hacer. La funcion revienta antes, diciendolo con
-- palabras. Lo demas es identico a 20260910240000.
CREATE OR REPLACE FUNCTION public.registrar_gasto_operacion(p_gasto_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $cuerpo$
DECLARE
  v_g          record;
  v_asiento_id uuid;
  v_numero     text;
  v_iva_mxn    numeric(14,2);
  v_sub_mxn    numeric(14,2);
  v_cuenta_haber text;
  v_linea      integer := 0;
BEGIN
  IF NOT public.puede_gestionar_gastos() THEN
    RAISE EXCEPTION 'No autorizado para registrar gastos de operacion.'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_g FROM public.gastos_operacion WHERE id = p_gasto_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El gasto % no existe.', p_gasto_id USING ERRCODE = 'P0002';
  END IF;

  IF v_g.estado = 'registrado' THEN
    RETURN v_g.asiento_id;
  END IF;
  IF v_g.estado = 'cancelado' THEN
    RAISE EXCEPTION 'El gasto % esta cancelado y no se puede registrar.', p_gasto_id;
  END IF;

  -- El relleno del generador no llega al asiento.
  IF v_g.moneda <> 'MXN' AND v_g.tipo_cambio = 1 THEN
    RAISE EXCEPTION
      'El gasto viene en % y sigue con tipo de cambio 1, que es el relleno con que nace un borrador recurrente. Captura el tipo de cambio del mes antes de registrarlo: asi se asentarian % como si fueran pesos.',
      v_g.moneda, v_g.total
      USING ERRCODE = '23514';
  END IF;

  -- El IVA en pesos se deriva del TOTAL EN PESOS, no de `iva * tipo_cambio`.
  -- Como `total_mxn` es editable, multiplicar cada parte por su cuenta dejaria
  -- el asiento descuadrado en cuanto alguien lo ajustara al importe del banco.
  v_iva_mxn := CASE WHEN v_g.total > 0
                    THEN round(v_g.total_mxn * (v_g.iva / v_g.total), 2)
                    ELSE 0 END;
  v_sub_mxn := v_g.total_mxn - v_iva_mxn;

  v_cuenta_haber := CASE WHEN v_g.pagado_en IS NOT NULL THEN '102' ELSE '205' END;

  v_numero := public.generate_entry_number(
                'egreso',
                extract(year  FROM v_g.fecha)::int,
                extract(month FROM v_g.fecha)::int);

  INSERT INTO public.accounting_entries (
    entry_number, entry_type, entry_date, period_year, period_month,
    description, source_type, source_id, is_posted, posted_at, created_by
  ) VALUES (
    v_numero, 'egreso', v_g.fecha,
    extract(year FROM v_g.fecha)::int, extract(month FROM v_g.fecha)::int,
    v_g.proveedor || ' — ' || v_g.descripcion,
    'gasto_operacion', v_g.id, true, now(), auth.uid()
  ) RETURNING id INTO v_asiento_id;

  v_linea := v_linea + 1;
  INSERT INTO public.accounting_entry_lines
    (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
  VALUES (v_asiento_id, v_linea, v_g.cuenta_contable,
          v_g.proveedor || ' — ' || v_g.descripcion, v_sub_mxn, 0, v_g.cfdi_uuid);

  IF v_iva_mxn > 0 THEN
    v_linea := v_linea + 1;
    INSERT INTO public.accounting_entry_lines
      (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
    VALUES (v_asiento_id, v_linea, '108',
            'IVA acreditable — ' || v_g.proveedor, v_iva_mxn, 0, v_g.cfdi_uuid);
  END IF;

  v_linea := v_linea + 1;
  INSERT INTO public.accounting_entry_lines
    (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
  VALUES (v_asiento_id, v_linea, v_cuenta_haber,
          CASE WHEN v_g.pagado_en IS NOT NULL
               THEN 'Pago a ' || v_g.proveedor
               ELSE 'Por pagar a ' || v_g.proveedor END,
          0, v_g.total_mxn, v_g.cfdi_uuid);

  UPDATE public.gastos_operacion
     SET estado = 'registrado', asiento_id = v_asiento_id, updated_at = now()
   WHERE id = p_gasto_id;

  RETURN v_asiento_id;
END;
$cuerpo$;

REVOKE EXECUTE ON FUNCTION public.registrar_gasto_operacion(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.registrar_gasto_operacion(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Que el borrador lo diga desde que nace
-- ---------------------------------------------------------------------------
-- El CHECK frena el dano al final del camino. La nota lo dice al principio,
-- que es donde alguien todavia puede corregirlo sin toparse con un error.
CREATE OR REPLACE FUNCTION public.generar_borradores_de_gastos_recurrentes(p_periodo text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $cuerpo$
DECLARE
  v_periodo text := coalesce(p_periodo, to_char(current_date, 'YYYY-MM'));
  v_creados integer := 0;
  v_r       record;
BEGIN
  IF NOT public.puede_gestionar_gastos() THEN
    RAISE EXCEPTION 'No autorizado para generar gastos recurrentes.'
      USING ERRCODE = '42501';
  END IF;

  IF v_periodo !~ '^\d{4}-\d{2}$' THEN
    RAISE EXCEPTION 'El periodo debe venir como AAAA-MM y llego "%".', v_periodo;
  END IF;

  FOR v_r IN SELECT * FROM public.gastos_recurrentes WHERE activo = true LOOP
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM public.gastos_operacion g
       WHERE g.recurrente_id = v_r.id AND g.periodo = v_periodo
         AND g.estado <> 'cancelado');

    INSERT INTO public.gastos_operacion (
      fecha, cuenta_contable, proveedor, descripcion,
      moneda, tipo_cambio, subtotal, iva, total, total_mxn,
      estado, recurrente_id, periodo, notas, creado_por
    ) VALUES (
      to_date(v_periodo || '-' || lpad(v_r.dia_del_mes::text, 2, '0'), 'YYYY-MM-DD'),
      v_r.cuenta_contable, v_r.proveedor, v_r.descripcion,
      v_r.moneda, 1,
      v_r.subtotal_estimado, v_r.iva_estimado,
      greatest(v_r.subtotal_estimado + v_r.iva_estimado, 0.01),
      greatest(v_r.subtotal_estimado + v_r.iva_estimado, 0.01),
      'borrador', v_r.id, v_periodo,
      CASE WHEN v_r.moneda <> 'MXN'
           THEN 'Falta capturar el tipo de cambio de ' || v_r.moneda ||
                ' del periodo ' || v_periodo || '. El 1 es relleno.'
           ELSE NULL END,
      auth.uid()
    );
    v_creados := v_creados + 1;
  END LOOP;

  RETURN v_creados;
END;
$cuerpo$;

REVOKE EXECUTE ON FUNCTION public.generar_borradores_de_gastos_recurrentes(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.generar_borradores_de_gastos_recurrentes(text) TO authenticated, service_role;
