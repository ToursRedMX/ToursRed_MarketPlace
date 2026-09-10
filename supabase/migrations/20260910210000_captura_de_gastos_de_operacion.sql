-- Captura de gastos de operacion: lo unico que le faltaba al reporte maestro.
--
-- ============================================================================
-- POR QUE
-- ============================================================================
--
-- El catalogo de cuentas ya tenia las cuentas de gasto desde hace meses:
--
--     601.01  Gastos por servicios (internet, software, hosting)
--     601.02  Gastos operativos (renta, papeleria, luz)
--     601.03  Viaticos     602  Tecnologia     603  Marketing
--
-- Pero NO EXISTIA TABLA donde capturarlos, ni siquiera a mano: los asientos
-- solo se generaban desde los nueve `source_type` automaticos. O sea que un
-- pago a Telcel o a Anthropic no podia entrar al sistema por ningun lado.
--
-- Consecuencia: el reporte maestro lleva un aviso fijo diciendo que los gastos
-- de operacion no estan incluidos, para que un cero no se lea como "no hay
-- gastos". Esta migracion es lo que permite quitar ese aviso.
--
-- ============================================================================
-- LAS DECISIONES, Y DE QUIEN SON
-- ============================================================================
--
-- MONEDA. Se guarda la moneda original y su tipo de cambio, no un peso ya
-- convertido a mano. Con MXN el tipo de cambio es 1 y no se pregunta. El
-- motivo es de Axel: Anthropic factura en USD y el SAT pregunta que tipo de
-- cambio se uso; convertir a mano deja esa respuesta sin rastro.
--
-- TOTAL EN PESOS EDITABLE. `total_mxn` se propone como `total * tipo_cambio`,
-- pero se guarda como columna propia y se puede corregir. El banco aplica su
-- propio tipo de cambio y casi nunca cuadra al centavo con el del CFDI; entre
-- forzar la formula y poder asentar lo que de verdad salio del banco, gana lo
-- segundo.
--
-- IVA OPCIONAL. Hay gastos legitimos sin IVA -- un proveedor extranjero como
-- Anthropic no lo traslada. `iva` puede ser 0 y entonces el asiento no toca
-- la cuenta de IVA acreditable.
--
-- PERMISO PROPIO, NO ROL. `admin_permissions` ya tiene 25 permisos granulares,
-- asi que este se suma ahi como `can_manage_expenses` en vez de abrirlo a todo
-- admin. Tambien fue decision de Axel.
--
-- RECURRENTES QUE NO SE ASIENTAN SOLOS. Telcel varia de mes a mes y Claude
-- viene en USD con otro tipo de cambio cada vez. Por eso una plantilla genera
-- un BORRADOR, no un gasto: alguien lo revisa, corrige el importe y lo
-- registra. Un gasto que se asienta solo con el importe del mes pasado es
-- peor que no tenerlo, porque parece cierto.

-- ---------------------------------------------------------------------------
-- 1. El permiso
-- ---------------------------------------------------------------------------
ALTER TABLE public.admin_permissions
  ADD COLUMN IF NOT EXISTS can_manage_expenses boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.admin_permissions.can_manage_expenses IS
  'Permite capturar, editar y registrar gastos de operacion en /admin/gastos.';

-- ---------------------------------------------------------------------------
-- 2. Plantillas de gasto recurrente
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.gastos_recurrentes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre            text NOT NULL,
  cuenta_contable   text NOT NULL REFERENCES public.chart_of_accounts(code),
  proveedor         text NOT NULL,
  descripcion       text NOT NULL,
  moneda            text NOT NULL DEFAULT 'MXN',
  subtotal_estimado numeric(14,2) NOT NULL DEFAULT 0,
  iva_estimado      numeric(14,2) NOT NULL DEFAULT 0,
  dia_del_mes       integer NOT NULL DEFAULT 1,
  activo            boolean NOT NULL DEFAULT true,
  creado_por        uuid REFERENCES public.users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT gastos_recurrentes_dia_valido   CHECK (dia_del_mes BETWEEN 1 AND 28),
  CONSTRAINT gastos_recurrentes_moneda_valida CHECK (moneda ~ '^[A-Z]{3}$'),
  CONSTRAINT gastos_recurrentes_montos_no_negativos
    CHECK (subtotal_estimado >= 0 AND iva_estimado >= 0)
);

-- Hasta 28 y no 31: un recurrente al 31 no existiria en febrero, y la regla
-- "el ultimo dia del mes" es otra cosa que aqui no se necesita.
COMMENT ON TABLE public.gastos_recurrentes IS
  'Plantillas de gasto mensual. Generan BORRADORES que alguien revisa; nunca '
  'asientan solas, porque el importe y el tipo de cambio cambian cada mes.';

-- ---------------------------------------------------------------------------
-- 3. Los gastos
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.gastos_operacion (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha             date NOT NULL,
  cuenta_contable   text NOT NULL REFERENCES public.chart_of_accounts(code),
  proveedor         text NOT NULL,
  descripcion       text NOT NULL,

  moneda            text NOT NULL DEFAULT 'MXN',
  tipo_cambio       numeric(14,6) NOT NULL DEFAULT 1,
  subtotal          numeric(14,2) NOT NULL,
  iva               numeric(14,2) NOT NULL DEFAULT 0,
  total             numeric(14,2) NOT NULL,
  total_mxn         numeric(14,2) NOT NULL,

  metodo_pago       text,
  referencia_pago   text,
  pagado_en         date,

  cfdi_uuid         text,
  cfdi_xml          text,
  comprobante_url   text,
  notas             text,

  estado            text NOT NULL DEFAULT 'borrador',
  recurrente_id     uuid REFERENCES public.gastos_recurrentes(id) ON DELETE SET NULL,
  periodo           text,
  asiento_id        uuid REFERENCES public.accounting_entries(id),
  creado_por        uuid REFERENCES public.users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT gastos_estado_valido CHECK (estado IN ('borrador','registrado','cancelado')),
  CONSTRAINT gastos_moneda_valida CHECK (moneda ~ '^[A-Z]{3}$'),
  CONSTRAINT gastos_montos_no_negativos CHECK (subtotal >= 0 AND iva >= 0 AND total > 0),
  CONSTRAINT gastos_total_mxn_positivo CHECK (total_mxn > 0),
  CONSTRAINT gastos_tipo_cambio_positivo CHECK (tipo_cambio > 0),

  -- Con MXN el tipo de cambio solo puede ser 1. Sin esto, alguien podria
  -- capturar pesos con un tipo de cambio de 17 y multiplicar el gasto.
  CONSTRAINT gastos_mxn_tipo_cambio_uno
    CHECK (moneda <> 'MXN' OR tipo_cambio = 1),

  -- El total tiene que ser la suma. Se tolera un centavo por el redondeo con
  -- que algunos proveedores emiten.
  CONSTRAINT gastos_total_cuadra
    CHECK (abs(total - (subtotal + iva)) <= 0.01),

  -- Un gasto registrado ya movio contabilidad: tiene que tener su asiento.
  CONSTRAINT gastos_registrado_tiene_asiento
    CHECK (estado <> 'registrado' OR asiento_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS gastos_operacion_fecha_idx    ON public.gastos_operacion (fecha DESC);
CREATE INDEX IF NOT EXISTS gastos_operacion_estado_idx   ON public.gastos_operacion (estado);
CREATE INDEX IF NOT EXISTS gastos_operacion_cuenta_idx   ON public.gastos_operacion (cuenta_contable);

-- Un CFDI no se puede capturar dos veces. Parcial porque la mayoria de los
-- gastos no traera UUID (Anthropic no emite CFDI) y NULL no debe chocar.
CREATE UNIQUE INDEX IF NOT EXISTS gastos_operacion_cfdi_unico
  ON public.gastos_operacion (cfdi_uuid) WHERE cfdi_uuid IS NOT NULL;

-- Una plantilla genera UN borrador por periodo. Evita que correr el generador
-- dos veces en el mismo mes duplique el gasto.
CREATE UNIQUE INDEX IF NOT EXISTS gastos_operacion_recurrente_periodo_unico
  ON public.gastos_operacion (recurrente_id, periodo)
  WHERE recurrente_id IS NOT NULL AND estado <> 'cancelado';

COMMENT ON TABLE public.gastos_operacion IS
  'Gastos de operacion capturados a mano o desde un CFDI. Solo los que estan '
  'en estado registrado tienen asiento y entran a vista_movimientos_financieros.';
COMMENT ON COLUMN public.gastos_operacion.total_mxn IS
  'Importe en pesos que se asienta. Se propone como total * tipo_cambio pero '
  'es editable: el banco aplica su propio tipo de cambio.';
COMMENT ON COLUMN public.gastos_operacion.cfdi_xml IS
  'XML completo del CFDI, si lo hubo. Se guarda para poder volver a derivar '
  'los montos del original si alguien duda de una cifra capturada.';

-- ---------------------------------------------------------------------------
-- 4. Quien puede
-- ---------------------------------------------------------------------------
-- Se apoya en `current_user_has_role`, que ademas de mirar el rol EXCLUYE a los
-- usuarios bloqueados (`is_active = false`). Las politicas viejas de
-- `accounting_entries` y `chart_of_accounts` consultan `users` directo y por
-- eso no lo hacen; aqui no se repite ese patron.
CREATE OR REPLACE FUNCTION public.puede_gestionar_gastos()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $cuerpo$
  SELECT public.current_user_has_role(ARRAY['admin','accountant'])
     AND (
       -- El super admin no depende de la tabla de permisos.
       EXISTS (SELECT 1 FROM public.users u
                WHERE u.id = auth.uid() AND u.is_super_admin = true)
       OR EXISTS (SELECT 1 FROM public.admin_permissions p
                   WHERE p.user_id = auth.uid() AND p.can_manage_expenses = true)
     );
$cuerpo$;

REVOKE EXECUTE ON FUNCTION public.puede_gestionar_gastos() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.puede_gestionar_gastos() TO authenticated, service_role;

COMMENT ON FUNCTION public.puede_gestionar_gastos() IS
  'True si el usuario es admin o contable ACTIVO y tiene can_manage_expenses '
  '(o es super admin). Usada por las RLS de gastos_operacion.';

ALTER TABLE public.gastos_operacion   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gastos_recurrentes ENABLE ROW LEVEL SECURITY;

DO $politicas$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['gastos_operacion','gastos_recurrentes'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "ver %1$s"       ON public.%1$I', t);
    EXECUTE format('DROP POLICY IF EXISTS "gestionar %1$s" ON public.%1$I', t);
    EXECUTE format('DROP POLICY IF EXISTS "service_role %1$s" ON public.%1$I', t);

    -- Ver: tambien quien solo tiene lectura de contabilidad.
    EXECUTE format($p$
      CREATE POLICY "ver %1$s" ON public.%1$I FOR SELECT TO authenticated
      USING (
        public.puede_gestionar_gastos()
        OR (public.current_user_has_role(ARRAY['admin','accountant'])
            AND EXISTS (SELECT 1 FROM public.admin_permissions p
                         WHERE p.user_id = auth.uid() AND p.can_view_accounting = true))
      )$p$, t);

    -- Escribir: solo con el permiso de gastos.
    EXECUTE format($p$
      CREATE POLICY "gestionar %1$s" ON public.%1$I FOR ALL TO authenticated
      USING (public.puede_gestionar_gastos())
      WITH CHECK (public.puede_gestionar_gastos())$p$, t);

    EXECUTE format($p$
      CREATE POLICY "service_role %1$s" ON public.%1$I FOR ALL TO service_role
      USING (true) WITH CHECK (true)$p$, t);
  END LOOP;
END $politicas$;

-- Los permisos de tabla. Supabase los pone solos por privilegios por defecto,
-- pero escribirlos hace que la migracion no dependa de una configuracion que no
-- se ve en el repo. `anon` no toca gastos ni para leer.
REVOKE ALL ON public.gastos_operacion   FROM PUBLIC, anon;
REVOKE ALL ON public.gastos_recurrentes FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gastos_operacion   TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gastos_recurrentes TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. El asiento contable
-- ---------------------------------------------------------------------------
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
  -- Autorizacion explicita: la funcion es SECURITY DEFINER, asi que sin esto
  -- se saltaria las RLS de arriba.
  IF NOT public.puede_gestionar_gastos() THEN
    RAISE EXCEPTION 'No autorizado para registrar gastos de operacion.'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_g FROM public.gastos_operacion WHERE id = p_gasto_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El gasto % no existe.', p_gasto_id USING ERRCODE = 'P0002';
  END IF;

  IF v_g.estado = 'registrado' THEN
    -- Idempotente: registrar dos veces no crea dos asientos.
    RETURN v_g.asiento_id;
  END IF;
  IF v_g.estado = 'cancelado' THEN
    RAISE EXCEPTION 'El gasto % esta cancelado y no se puede registrar.', p_gasto_id;
  END IF;

  -- El IVA en pesos se deriva del TOTAL EN PESOS, no de `iva * tipo_cambio`.
  -- Como `total_mxn` es editable, multiplicar cada parte por su cuenta dejaria
  -- el asiento descuadrado en cuanto alguien lo ajustara al importe del banco.
  -- Repartiendo en proporcion, el asiento cuadra siempre.
  v_iva_mxn := CASE WHEN v_g.total > 0
                    THEN round(v_g.total_mxn * (v_g.iva / v_g.total), 2)
                    ELSE 0 END;
  v_sub_mxn := v_g.total_mxn - v_iva_mxn;

  -- Pagado sale del banco; pendiente es deuda con un acreedor.
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
-- 6. Los borradores de los recurrentes
-- ---------------------------------------------------------------------------
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
    -- El indice unico ya impide duplicar, pero se comprueba antes para poder
    -- devolver cuantos se crearon DE VERDAD en vez de reventar a la segunda
    -- corrida. Correr el generador dos veces el mismo mes no debe doler.
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM public.gastos_operacion g
       WHERE g.recurrente_id = v_r.id AND g.periodo = v_periodo
         AND g.estado <> 'cancelado');

    INSERT INTO public.gastos_operacion (
      fecha, cuenta_contable, proveedor, descripcion,
      moneda, tipo_cambio, subtotal, iva, total, total_mxn,
      estado, recurrente_id, periodo, creado_por
    ) VALUES (
      to_date(v_periodo || '-' || lpad(v_r.dia_del_mes::text, 2, '0'), 'YYYY-MM-DD'),
      v_r.cuenta_contable, v_r.proveedor, v_r.descripcion,
      v_r.moneda, 1,
      v_r.subtotal_estimado, v_r.iva_estimado,
      -- `greatest(..., 0.01)` porque el CHECK exige total > 0 y una plantilla
      -- puede tener estimado 0 cuando el importe cambia tanto que no vale la
      -- pena adivinarlo. El borrador existe para que alguien lo corrija.
      greatest(v_r.subtotal_estimado + v_r.iva_estimado, 0.01),
      greatest(v_r.subtotal_estimado + v_r.iva_estimado, 0.01),
      'borrador', v_r.id, v_periodo, auth.uid()
    );
    v_creados := v_creados + 1;
  END LOOP;

  RETURN v_creados;
END;
$cuerpo$;

REVOKE EXECUTE ON FUNCTION public.generar_borradores_de_gastos_recurrentes(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.generar_borradores_de_gastos_recurrentes(text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. El tipo de asiento nuevo
-- ---------------------------------------------------------------------------
-- `accounting_entries.source_type` tiene un CHECK con lista blanca. Sin este
-- paso, la funcion de arriba reventaria con 23514 en la primera captura.
ALTER TABLE public.accounting_entries
  DROP CONSTRAINT IF EXISTS accounting_entries_source_type_check;

ALTER TABLE public.accounting_entries
  ADD CONSTRAINT accounting_entries_source_type_check
  CHECK (source_type = ANY (ARRAY[
    'booking', 'payout', 'cancellation', 'manual', 'membership',
    'gift_card', 'gift_card_sale', 'gift_card_redemption', 'gift_card_expiration',
    'featured_slot', 'apertura', 'insurance_settlement', 'insurance_commission',
    'wallet_topup', 'executive_commission', 'insurance', 'supplement',
    'optional_service', 'payment_plan_installment', 'dispute', 'payment_refund',
    'gasto_operacion'
  ]));

-- ---------------------------------------------------------------------------
-- 8. La cuenta tiene que ser de gasto
-- ---------------------------------------------------------------------------
-- La llave foranea acepta CUALQUIER codigo del catalogo, incluido '102'
-- (Bancos). Un gasto cargado a Bancos duplicaria el activo y la vista de abajo
-- seguiria diciendo "egreso" porque el bloque no mira la cuenta. Un CHECK no
-- puede consultar otra tabla, asi que va por trigger.
CREATE OR REPLACE FUNCTION public.validar_cuenta_de_gasto()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $cuerpo$
DECLARE
  v_tipo   text;
  v_activa boolean;
BEGIN
  SELECT c.account_type, c.is_active INTO v_tipo, v_activa
    FROM public.chart_of_accounts c
   WHERE c.code = NEW.cuenta_contable;

  IF v_tipo IS NULL THEN
    RAISE EXCEPTION 'La cuenta % no existe en el catalogo.', NEW.cuenta_contable
      USING ERRCODE = '23514';
  END IF;
  IF v_tipo NOT IN ('gasto', 'costo') THEN
    RAISE EXCEPTION 'La cuenta % es de tipo % y un gasto solo puede cargarse a una cuenta de gasto o costo.',
      NEW.cuenta_contable, v_tipo USING ERRCODE = '23514';
  END IF;
  IF v_activa IS NOT TRUE THEN
    RAISE EXCEPTION 'La cuenta % esta inactiva.', NEW.cuenta_contable
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$cuerpo$;

DROP TRIGGER IF EXISTS gastos_operacion_valida_cuenta   ON public.gastos_operacion;
DROP TRIGGER IF EXISTS gastos_recurrentes_valida_cuenta ON public.gastos_recurrentes;

CREATE TRIGGER gastos_operacion_valida_cuenta
  BEFORE INSERT OR UPDATE OF cuenta_contable ON public.gastos_operacion
  FOR EACH ROW EXECUTE FUNCTION public.validar_cuenta_de_gasto();

CREATE TRIGGER gastos_recurrentes_valida_cuenta
  BEFORE INSERT OR UPDATE OF cuenta_contable ON public.gastos_recurrentes
  FOR EACH ROW EXECUTE FUNCTION public.validar_cuenta_de_gasto();

-- `updated_at` va aparte: el validador solo corre cuando cambia la cuenta, asi
-- que si el sello viviera ahi se quedaria viejo en cualquier otra edicion.
CREATE OR REPLACE FUNCTION public.sellar_updated_at_gastos()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $cuerpo$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$cuerpo$;

DROP TRIGGER IF EXISTS gastos_operacion_sella_updated_at   ON public.gastos_operacion;
DROP TRIGGER IF EXISTS gastos_recurrentes_sella_updated_at ON public.gastos_recurrentes;

CREATE TRIGGER gastos_operacion_sella_updated_at
  BEFORE UPDATE ON public.gastos_operacion
  FOR EACH ROW EXECUTE FUNCTION public.sellar_updated_at_gastos();

CREATE TRIGGER gastos_recurrentes_sella_updated_at
  BEFORE UPDATE ON public.gastos_recurrentes
  FOR EACH ROW EXECUTE FUNCTION public.sellar_updated_at_gastos();

-- ---------------------------------------------------------------------------
-- 9. El bloque 19 de la vista: los gastos de operacion
-- ---------------------------------------------------------------------------
-- La vista se reescribe entera porque CREATE OR REPLACE VIEW no admite
-- parches: hay que volver a dar el cuerpo completo. Los bloques 1 a 18 son
-- copia literal de 20260910200000; lo unico nuevo es el 19 al final.
--
-- Como cuadra el bloque nuevo:
--
--   Gasto PAGADO      activo -total_mxn = pasivo 0 + ingreso -total_mxn   OK
--   Gasto POR PAGAR   activo 0          = pasivo +total_mxn + ingreso -total_mxn
--
-- El segundo caso es el que suele confundir: no salio dinero del banco, pero
-- ya se debe. El gasto se reconoce cuando se devenga, no cuando se paga, y el
-- contrapeso es la deuda con el acreedor. Cuando se pague, se edita el gasto
-- con su `pagado_en` y el asiento cambia de '205' a '102'.
--
-- La categoria es fija (`gasto_operacion`) y no una por cuenta contable. Es a
-- proposito: la prueba 8f afirma la lista EXACTA de categorias, asi que una
-- categoria por cuenta convertiria cada cuenta nueva del catalogo en una
-- prueba rota. El desglose por cuenta se ve en la pantalla de gastos.

CREATE OR REPLACE VIEW public.vista_movimientos_financieros
WITH (security_invoker = true) AS

-- 1. Cobros por pasarela.
--
--    El caso normal genera pasivo: el dinero entra pero es de la agencia hasta
--    que se reconoce la comision (bloque 8). La excepcion son los productos
--    propios de ToursRed, que no le deben nada a nadie.
SELECT
  pt.created_at                                   AS fecha,
  'cobro_' || coalesce(pt.charge_context,'otro')  AS categoria,
  'ingreso'                                       AS naturaleza,
  coalesce(pt.charge_context,'cobro')             AS descripcion,
  coalesce(b.booking_code, left(pt.id::text, 8))  AS referencia,
  a.name                                          AS entidad,
  coalesce(pt.payment_processor,'(sin procesador)') AS metodo,
  pt.amount                                       AS caja,
  CASE WHEN pt.charge_context IN ('membership') THEN 0 ELSE pt.amount END AS pasivo,
  CASE WHEN pt.charge_context IN ('membership') THEN pt.amount ELSE 0 END AS ingreso,
  0::numeric                                      AS traspaso,
  'payment_transactions'                          AS origen_tabla,
  pt.id                                           AS origen_id
FROM public.payment_transactions pt
LEFT JOIN public.bookings b ON b.id = pt.booking_id
LEFT JOIN public.agencies  a ON a.id = b.agency_id
WHERE pt.status = 'succeeded'

UNION ALL

-- 2. Comision del procesador. Sale del banco y es gasto.
--    OJO: subregistrada. Conekta y OpenPay reportan 0.00 y si cobran.
SELECT pt.created_at, 'comision_procesador', 'egreso',
       'Comision ' || coalesce(pt.payment_processor,'procesador'),
       left(pt.id::text, 8), NULL, coalesce(pt.payment_processor,'(sin procesador)'),
       -pt.processor_fee, 0, -pt.processor_fee, 0,
       'payment_transactions', pt.id
FROM public.payment_transactions pt
WHERE pt.status = 'succeeded' AND coalesce(pt.processor_fee,0) > 0

UNION ALL

-- 3. (libre) Las recargas ya no se leen de `openpay_wallet_topups`: las cubre
--     el bloque 11, que lee el monedero entero. Comprobado que son el mismo
--     dinero -- 3 filas y $51,600.00 en las dos -- asi que leer las dos seria
--     contarlo doble.

-- 4. Tarjetas de regalo vendidas. Pasivo hasta que se canjean o caducan.
SELECT gc.purchased_at, 'tarjeta_regalo', 'ingreso', 'Venta de tarjeta de regalo',
       gc.code, gc.purchaser_email, coalesce(gc.payment_provider,'(sin proveedor)'),
       gc.amount, gc.amount, 0, 0,
       'gift_cards', gc.id
FROM public.gift_cards gc
WHERE gc.payment_status = 'paid'

UNION ALL

-- 5. Servicios opcionales cobrados. Su INGRESO ya viene en commission_records
--    (bloque 8), asi que aqui solo entra la caja. Los pagados con puntos no
--    mueven caja.
SELECT coalesce(bos.paid_at, bos.created_at), 'servicio_opcional', 'ingreso',
       coalesce(bos.description,'Servicio opcional'),
       coalesce(b.booking_code, left(bos.id::text, 8)), a.name,
       coalesce(bos.payment_method,'(sin metodo)'),
       CASE WHEN bos.payment_method = 'points' THEN 0 ELSE bos.total_paid END,
       CASE WHEN bos.payment_method = 'points' THEN 0 ELSE bos.total_paid END,
       0,
       CASE WHEN bos.payment_method = 'points' THEN bos.total_paid ELSE 0 END,
       'booking_optional_services', bos.id
FROM public.booking_optional_services bos
LEFT JOIN public.bookings b ON b.id = bos.booking_id
LEFT JOIN public.agencies  a ON a.id = b.agency_id
WHERE bos.paid_at IS NOT NULL

UNION ALL

-- 6. Suplementos. Cero filas al 10-sep-2026; se incluye para que el dia que se
--    usen aparezcan solos en vez de faltar en silencio.
SELECT bs.created_at, 'suplemento', 'ingreso', 'Suplemento',
       coalesce(b.booking_code, left(bs.id::text, 8)), a.name, '(sin metodo)',
       bs.total_paid, bs.total_paid, 0, 0,
       'booking_supplements', bs.id
FROM public.booking_supplements bs
LEFT JOIN public.bookings b ON b.id = bs.booking_id
LEFT JOIN public.agencies  a ON a.id = b.agency_id
WHERE coalesce(bs.total_paid,0) > 0

UNION ALL

-- 7. Tours destacados. Servicio de promocion que se le cobra a la agencia:
--    ingreso 100% de ToursRed, sin pasivo, porque no hay nada que liberar.
SELECT fts.payment_confirmed_at, 'tour_destacado', 'ingreso',
       'Promocion de tour destacado', left(fts.id::text, 8), a.name,
       coalesce(fts.payment_provider,'(sin proveedor)'),
       fts.total_amount, 0, fts.total_amount, 0,
       'featured_tour_slots', fts.id
FROM public.featured_tour_slots fts
LEFT JOIN public.agencies a ON a.id = fts.agency_id
WHERE fts.payment_confirmed_at IS NOT NULL

UNION ALL

-- 8. Reconocimiento del ingreso. Aqui es donde el dinero deja de ser de la
--    agencia y pasa a ser de ToursRed.
--
--    EL DOBLE FILTRO NO ES OPCIONAL -- ver la cabecera. Se exige que la
--    reserva este viva Y que el registro no este anulado, porque al
--    10-sep-2026 hay 4 reservas canceladas cuyo registro sigue en `processed`.
SELECT coalesce(cr.processed_at, cr.created_at), 'reconocimiento_ingreso', 'ingreso',
       'Comision y cargo por servicio',
       coalesce(b.booking_code, left(cr.id::text, 8)), a.name, NULL,
       0, -cr.platform_total_revenue, cr.platform_total_revenue, 0,
       'commission_records', cr.id
FROM public.commission_records cr
JOIN public.bookings b ON b.id = cr.booking_id
LEFT JOIN public.agencies a ON a.id = cr.agency_id
WHERE b.status NOT IN ('cancelled','cancellation_processing')
  AND coalesce(cr.status,'') <> 'voided'

UNION ALL

-- 9. Comision que paga la aseguradora. Ingreso puro, sin pasivo.
SELECT icr.receipt_date, 'comision_aseguradora', 'ingreso',
       'Comision de ' || coalesce(icr.provider_name,'aseguradora'),
       coalesce(icr.invoice_reference, left(icr.id::text, 8)), icr.provider_name, NULL,
       icr.amount, 0, icr.amount, 0,
       'insurance_commission_receipts', icr.id
FROM public.insurance_commission_receipts icr

UNION ALL

-- 10. Liberacion a la agencia. Salida de caja real y baja del pasivo.
SELECT ap.payment_date, 'pago_agencia', 'egreso', 'Liberacion de fondos',
       coalesce(ap.payout_code, left(ap.id::text, 8)), a.name,
       coalesce(ap.payment_method,'(sin metodo)'),
       -ap.amount, -ap.amount, 0, 0,
       'agency_payouts', ap.id
FROM public.agency_payouts ap
LEFT JOIN public.agencies a ON a.id = ap.agency_id
WHERE ap.status = 'completed'

UNION ALL

-- 11. EL MONEDERO ENTERO, con sus ocho tipos.
--
--     Se lee de `toursred_cash_transactions` y no de las tablas sueltas de
--     cada movimiento, por la misma razon en los dos sentidos:
--
--     * `openpay_wallet_topups` solo cubre el riel de OpenPay. El enum del
--       monedero tiene DOS tipos de recarga (`topup_spei` y `topup_codi`), y
--       ocho tipos en total. Leer la tabla suelta dejaba fuera cinco.
--     * Las tablas de cancelacion dan $17,532.54 de reembolso; el monedero
--       registra $23,096.54. Hay 9 reembolsos que no aparecen en
--       `refund_amount_to_traveler`.
--
--     Comprobado que `topup_spei` en el monedero y `openpay_wallet_topups`
--     completadas son EL MISMO dinero: 3 filas y $51,600.00 en las dos. Leer
--     las dos lo contaria doble, y por eso el bloque 3 quedo vacio.
--
--     El mapeo por tipo, que es donde esta toda la sustancia:
--
--       topup_spei / topup_codi  dinero nuevo que entra al banco y se le debe
--                                al viajero -> caja + y pasivo +
--       debit                    paga una reserva con su saldo. NO es caja
--                                nueva: ya entro en la recarga. Solo cambia de
--                                acreedor -> traspaso
--       refund                   se le devuelve al monedero, no a la tarjeta.
--                                Tampoco sale del banco -> traspaso
--       gift_card                canje. El pasivo pasa de "tarjetas por
--                                canjear" (218-12) a "monedero" (218-11). Ni
--                                caja ni ingreso -> traspaso
--       promotion / credit /     saldo que regala o ajusta ToursRed. No entra
--       adjustment               dinero pero se crea una deuda, y eso cuesta
--                                -> pasivo + e ingreso -
SELECT tct.created_at,
       'monedero_' || tct.type::text, 
       CASE WHEN tct.amount < 0 THEN 'egreso' ELSE 'ingreso' END,
       'Monedero: ' || tct.type::text
         || coalesce(' (' || tct.reference_type || ')', ''),
       coalesce(b.booking_code, left(tct.id::text, 8)),
       nullif(trim(coalesce(u.first_name,'') || ' ' || coalesce(u.last_name,'')), ''),
       'toursred_cash',
       CASE WHEN tct.type::text IN ('topup_spei','topup_codi') THEN tct.amount ELSE 0 END,
       CASE WHEN tct.type::text IN ('topup_spei','topup_codi')            THEN tct.amount
            WHEN tct.type::text IN ('promotion','credit','adjustment')    THEN tct.amount
            ELSE 0 END,
       CASE WHEN tct.type::text IN ('promotion','credit','adjustment')    THEN -tct.amount
            ELSE 0 END,
       CASE WHEN tct.type::text IN ('debit','refund','gift_card')         THEN abs(tct.amount)
            ELSE 0 END,
       'toursred_cash_transactions', tct.id
FROM public.toursred_cash_transactions tct
LEFT JOIN public.users u ON u.id = tct.user_id
LEFT JOIN public.bookings b ON b.id = tct.reference_id

UNION ALL

-- 12. Reembolso AL METODO DE PAGO ORIGINAL. Este SI sale del banco.
--
--     Lo hace un admin desde el panel (`process-payment-refund`) para los casos
--     en que devolver al monedero no es opcion: una disputa ante PROFECO que
--     obligue a regresar el dinero a la misma tarjeta, por ejemplo. Son pocos
--     —la tabla esta vacia al 10-sep-2026— pero cuando ocurren es dinero que
--     de verdad se va, y confundirlos con un abono al monedero seria un error
--     grande sobre un importe grande.
--
--     `succeeded` es el estado terminal que ponen los webhooks de Stripe y
--     PayPal al confirmar la devolucion; `pending`, `processing` y `failed` no
--     han movido el banco todavia.
SELECT coalesce(pr.confirmed_at, pr.processed_at, pr.created_at),
       'reembolso_metodo_original', 'egreso',
       'Reembolso al metodo de pago original (' || coalesce(pr.refund_method,'sin metodo') || ')',
       coalesce(b.booking_code, left(pr.id::text, 8)), a.name,
       coalesce(pr.payment_processor,'(sin procesador)'),
       -pr.requested_amount, -pr.requested_amount, 0, 0,
       'payment_refunds', pr.id
FROM public.payment_refunds pr
LEFT JOIN public.bookings b ON b.id = pr.booking_id
LEFT JOIN public.agencies  a ON a.id = b.agency_id
WHERE pr.status = 'succeeded'

UNION ALL

-- 13. Lo que el procesador cobra POR reembolsar. Dinero nuevo que sale.
--
--     Se usa `processor_refund_fee` y NO `processor_fee_lost`: el segundo es la
--     comision del cobro original, que el procesador se queda al devolver. Esa
--     ya se conto como gasto en el bloque 2 cuando entro el dinero; volver a
--     restarla aqui seria contarla dos veces.
SELECT coalesce(pr.confirmed_at, pr.processed_at, pr.created_at),
       'comision_por_reembolso', 'egreso',
       'Comision de ' || coalesce(pr.payment_processor,'procesador') || ' por reembolsar',
       coalesce(b.booking_code, left(pr.id::text, 8)), a.name,
       coalesce(pr.payment_processor,'(sin procesador)'),
       -pr.processor_refund_fee, 0, -pr.processor_refund_fee, 0,
       'payment_refunds', pr.id
FROM public.payment_refunds pr
LEFT JOIN public.bookings b ON b.id = pr.booking_id
LEFT JOIN public.agencies  a ON a.id = b.agency_id
WHERE pr.status = 'succeeded' AND coalesce(pr.processor_refund_fee,0) > 0

UNION ALL

-- 14. (libre) El pago con monedero lo cubre el bloque 11, con el tipo `debit`.

-- 15. Comision al ejecutivo de cuenta. Es gasto en cuanto se devenga, sale del
--     banco cuando se paga, y mientras tanto es una DEUDA. Las tres cosas.
SELECT coalesce(ec.paid_at, ec.created_at), 'comision_ejecutivo', 'egreso',
       'Comision de ejecutivo (' || coalesce(ec.commission_type,'sin tipo') || ')',
       left(ec.id::text, 8), a.name, coalesce(ec.payment_reference,'(sin referencia)'),
       CASE WHEN ec.status = 'paid' THEN -ec.amount ELSE 0 END,
       -- Lo devengado y NO pagado es dinero que ToursRed debe. Sin esta linea
       -- la categoria descuadraba $736.25 contra la ecuacion contable.
       CASE WHEN ec.status = 'paid' THEN 0 ELSE ec.amount END,
       -ec.amount, 0,
       'executive_commissions', ec.id
FROM public.executive_commissions ec
LEFT JOIN public.agencies a ON a.id = ec.agency_id

UNION ALL

-- 16. Puntos otorgados. No mueven caja pero son un pasivo real y su costo es
--     ingreso que no se va a percibir. 100 puntos = 1 peso.
SELECT tpt.created_at, 'puntos_otorgados', 'egreso',
       'Puntos otorgados (' || coalesce(tpt.reference_type,'sin origen') || ')',
       left(tpt.id::text, 8),
       nullif(trim(coalesce(u.first_name,'') || ' ' || coalesce(u.last_name,'')), ''),
       'puntos',
       0, tpt.amount / 100.0, -tpt.amount / 100.0, 0,
       'toursred_points_transactions', tpt.id
FROM public.toursred_points_transactions tpt
LEFT JOIN public.users u ON u.id = tpt.user_id
WHERE tpt.type::text = 'earned'

UNION ALL

-- 17. Liquidacion a la aseguradora. Cero filas hoy; se incluye por lo mismo
--     que el bloque 6.
SELECT ist.payment_date, 'liquidacion_aseguradora', 'egreso',
       'Liquidacion a ' || coalesce(ist.provider_name,'aseguradora'),
       coalesce(ist.reference, left(ist.id::text, 8)), ist.provider_name, NULL,
       -ist.amount, -ist.amount, 0, 0,
       'insurance_settlements', ist.id
FROM public.insurance_settlements ist

UNION ALL

-- 18. Contracargos por disputa. Cero filas hoy.
SELECT pd.created_at, 'contracargo', 'egreso', 'Contracargo por disputa',
       left(pd.id::text, 8), NULL, NULL,
       -pd.amount, 0, -pd.amount, 0,
       'payment_disputes', pd.id
FROM public.payment_disputes pd

UNION ALL

-- 19. Gastos de operacion capturados a mano o desde un CFDI. Solo los
--     registrados: un borrador todavia no tiene asiento y no es un hecho.
SELECT g.fecha::timestamptz, 'gasto_operacion', 'egreso',
       g.proveedor || ' — ' || g.descripcion,
       coalesce(g.cfdi_uuid, left(g.id::text, 8)), g.proveedor,
       coalesce(g.metodo_pago, '(sin metodo)'),
       CASE WHEN g.pagado_en IS NOT NULL THEN -g.total_mxn ELSE 0 END,
       CASE WHEN g.pagado_en IS NOT NULL THEN 0 ELSE g.total_mxn END,
       -g.total_mxn, 0,
       'gastos_operacion', g.id
FROM public.gastos_operacion g
WHERE g.estado = 'registrado';


COMMENT ON VIEW public.vista_movimientos_financieros IS
  'Log financiero en tres capas: activo (movimiento de bancos), pasivo (dinero '
  'de terceros: viajeros y agencias) e ingreso (lo que ToursRed gano), mas '
  'traspaso para el dinero que cambia de dueno sin mover las tres. Se cumple '
  'activo = pasivo + ingreso en cada categoria; la prueba lo exige. La columna '
  'se llama `caja` por compatibilidad, pero es movimiento de activo. Insumo de '
  '/admin/reporte-maestro. Desde 20260910210000 SI incluye los gastos de '
  'operacion (bloque 19), en cuanto esten en estado registrado.';

REVOKE ALL ON public.vista_movimientos_financieros FROM PUBLIC;
REVOKE ALL ON public.vista_movimientos_financieros FROM anon;
GRANT SELECT ON public.vista_movimientos_financieros TO authenticated, service_role;
