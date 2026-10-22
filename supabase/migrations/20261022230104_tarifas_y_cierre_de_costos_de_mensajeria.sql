-- Costos de mensajeria: tarifas configurables por proveedor, consumo del mes y cierre mensual como gasto operativo.
--
-- Pedido de Axel (22-oct-2026). El costo de cada mensaje depende del proveedor. Como las comisiones de los
-- procesadores de pago, las tarifas se CONFIGURAN (no se cablean) y, al terminar el mes, se genera el gasto:
--
--   * Por cada proveedor y canal: cuantos mensajes incluye al mes SIN costo y cuanto cuesta cada uno despues.
--     Canales: sms, whatsapp y email. Proveedores: twilio (sms y whatsapp), labsmobile (sms),
--     smtp2go, sendgrid y zoho (email).
--   * Todo en MXN y SIN IVA (decision de Axel): los proveedores son extranjeros y no dan CFDI, asi que no hay IVA
--     que acreditar; el gasto se captura con iva = 0.
--   * Cuenta propia para ver cuanto se va al mes en este rubro: 607 «Gastos de mensajeria».
--   * El cierre mensual NO registra el gasto: lo deja en BORRADOR (decision de Axel) para que se revise y se
--     registre desde la pantalla de Gastos de Operacion, que ya genera su asiento (gasto contra 205 Acreedores
--     diversos, o contra 102 Bancos si ya se pago) y maneja pagos en parcialidades.
--
-- QUE SE CUENTA (por mes calendario en hora de Ciudad de Mexico):
--   * SMS: la suma de SEGMENTOS (un SMS de mas de 160 caracteres son varios) de los intentos que el proveedor acepto
--     (tienen id del proveedor). Incluye los codigos de verificacion. Un envio rechazado al instante no se cobra.
--     WhatsApp cuenta un mensaje por intento.
--   * Correo: los envios que el proveedor acepto, de bitacora_envio_correo (existe desde el 19-oct-2026; lo anterior
--     no esta en la bitacora y no se puede contar).
--   Es una ESTIMACION con la tarifa configurada, no la factura del proveedor: la que manda es la factura real.
--
-- Un mes cerrado queda CONGELADO en cierres_mensajeria (uso, tarifa y gasto de ese momento): cambiar la tarifa
-- despues no reescribe el pasado. Cerrar dos veces el mismo mes no duplica nada (unico por mes/proveedor/canal).

-- 1. La cuenta -------------------------------------------------------------------------------------------
INSERT INTO public.chart_of_accounts (code, sat_group_code, name, account_type, parent_code, level, nature, is_system, is_active, description)
VALUES ('607', '607', 'Gastos de mensajeria (SMS, WhatsApp y correo)', 'gasto', '60', 3, 'deudora', true, true,
        'Costo de los mensajes que salen de la plataforma: SMS y WhatsApp (Twilio, LabsMobile) y correo transaccional (SMTP2GO, SendGrid, Zoho). Proveedores extranjeros: sin CFDI, sin IVA acreditable.')
ON CONFLICT (code) DO NOTHING;

-- 2. Tarifas ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tarifas_mensajeria (
  proveedor          text        NOT NULL,
  canal              text        NOT NULL,
  incluidos_al_mes   integer     NOT NULL DEFAULT 0,
  costo_unitario_mxn numeric(12,4) NOT NULL DEFAULT 0,
  activo             boolean     NOT NULL DEFAULT true,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         uuid REFERENCES public.users(id),
  PRIMARY KEY (proveedor, canal),
  CONSTRAINT tarifas_mensajeria_incluidos_check CHECK (incluidos_al_mes >= 0),
  CONSTRAINT tarifas_mensajeria_costo_check CHECK (costo_unitario_mxn >= 0),
  CONSTRAINT tarifas_mensajeria_combinacion_check CHECK (
    (canal = 'sms'      AND proveedor IN ('twilio', 'labsmobile'))
 OR (canal = 'whatsapp' AND proveedor = 'twilio')
 OR (canal = 'email'    AND proveedor IN ('smtp2go', 'sendgrid', 'zoho')))
);

COMMENT ON TABLE public.tarifas_mensajeria IS
  'Cuantos mensajes incluye cada proveedor al mes sin costo y cuanto cuesta cada uno despues, en MXN y sin IVA. Unidad: segmento (SMS), mensaje (WhatsApp) o correo. Se edita desde Configuracion con guardar_tarifa_mensajeria.';

-- Arrancan en cero (nada incluido, costo cero): hasta que Axel configure una tarifa no se genera ningun gasto.
INSERT INTO public.tarifas_mensajeria (proveedor, canal) VALUES
  ('twilio', 'sms'), ('twilio', 'whatsapp'), ('labsmobile', 'sms'),
  ('smtp2go', 'email'), ('sendgrid', 'email'), ('zoho', 'email')
ON CONFLICT (proveedor, canal) DO NOTHING;

ALTER TABLE public.tarifas_mensajeria ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tarifas_mensajeria FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tarifas_mensajeria TO service_role;
-- Sin politicas para authenticated a proposito: se lee y se escribe SOLO por las funciones de abajo, que exigen ser
-- administrador con permiso de configuracion (y MFA si esta exigido).

-- 3. Cierres (congelan el mes) ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cierres_mensajeria (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  anio               integer     NOT NULL,
  mes                integer     NOT NULL,
  proveedor          text        NOT NULL,
  canal              text        NOT NULL,
  usados             bigint      NOT NULL,
  incluidos          integer     NOT NULL,
  excedente          bigint      NOT NULL,
  costo_unitario_mxn numeric(12,4) NOT NULL,
  costo_mxn          numeric(14,2) NOT NULL,
  gasto_id           uuid REFERENCES public.gastos_operacion(id) ON DELETE SET NULL,
  creado_por         uuid REFERENCES public.users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cierres_mensajeria_mes_check CHECK (mes BETWEEN 1 AND 12),
  CONSTRAINT cierres_mensajeria_unico UNIQUE (anio, mes, proveedor, canal)
);

COMMENT ON TABLE public.cierres_mensajeria IS
  'Un renglon por mes, proveedor y canal ya cerrado: uso, tarifa y costo de ese momento, y el gasto en borrador que generó (si hubo costo). Congela el mes: cambiar la tarifa despues no lo reescribe.';

ALTER TABLE public.cierres_mensajeria ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cierres_mensajeria FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cierres_mensajeria TO service_role;

-- 4. Ayudantes internos -----------------------------------------------------------------------------------
-- Lo que se paga: lo que pasa de lo incluido, por la tarifa, a centavos.
CREATE OR REPLACE FUNCTION messaging_private.costo_excedente(p_usados bigint, p_incluidos integer, p_unitario numeric)
RETURNS numeric
LANGUAGE sql IMMUTABLE SET search_path TO ''
AS $function$
  SELECT round(greatest(0, p_usados - p_incluidos)::numeric * p_unitario, 2);
$function$;

-- Consumo del mes calendario (hora de Ciudad de Mexico) por proveedor y canal. Ver el encabezado: que se cuenta.
CREATE OR REPLACE FUNCTION messaging_private.uso_mensajeria(p_anio integer, p_mes integer)
RETURNS TABLE(proveedor text, canal text, usados bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_desde timestamptz;
  v_hasta timestamptz;
BEGIN
  IF p_anio IS NULL OR p_mes IS NULL OR p_anio NOT BETWEEN 2020 AND 2100 OR p_mes NOT BETWEEN 1 AND 12 THEN
    RAISE EXCEPTION 'Periodo invalido';
  END IF;
  -- Los limites se arman como hora LOCAL y se convierten: sumar un mes a un timestamptz usaria la zona de la sesion (UTC).
  v_desde := make_timestamp(p_anio, p_mes, 1, 0, 0, 0) AT TIME ZONE 'America/Mexico_City';
  v_hasta := (make_timestamp(p_anio, p_mes, 1, 0, 0, 0) + interval '1 month') AT TIME ZONE 'America/Mexico_City';

  RETURN QUERY
    SELECT a.provider, a.channel, COALESCE(sum(a.segments), 0)::bigint
      FROM messaging_private.notification_attempts a
     WHERE NOT a.is_simulated
       AND a.provider_message_id IS NOT NULL
       AND a.created_at >= v_desde AND a.created_at < v_hasta
     GROUP BY a.provider, a.channel
    UNION ALL
    SELECT e.proveedor, 'email'::text, count(*)::bigint
      FROM public.bitacora_envio_correo e
     WHERE e.aceptado
       AND e.creado_en >= v_desde AND e.creado_en < v_hasta
     GROUP BY e.proveedor;
END
$function$;

-- 5. Pantalla de configuracion: leer y guardar tarifas ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_tarifas_mensajeria()
RETURNS TABLE(proveedor text, canal text, incluidos_al_mes integer, costo_unitario_mxn numeric, activo boolean, updated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
BEGIN
  PERFORM messaging_private.require_settings_admin();
  RETURN QUERY
    SELECT t.proveedor, t.canal, t.incluidos_al_mes, t.costo_unitario_mxn, t.activo, t.updated_at
      FROM public.tarifas_mensajeria t
     ORDER BY t.canal, t.proveedor;
END
$function$;

CREATE OR REPLACE FUNCTION public.guardar_tarifa_mensajeria(
  p_proveedor text, p_canal text, p_incluidos integer, p_costo numeric, p_activo boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
BEGIN
  PERFORM messaging_private.require_settings_admin();
  IF p_incluidos IS NULL OR p_incluidos < 0 OR p_incluidos > 1000000000
     OR p_costo IS NULL OR p_costo < 0 OR p_costo >= 1000
     OR p_activo IS NULL THEN
    RAISE EXCEPTION 'Tarifa invalida: los incluidos van de 0 a 1,000,000,000 y el costo por mensaje de 0 a 999.9999 MXN';
  END IF;
  UPDATE public.tarifas_mensajeria
     SET incluidos_al_mes = p_incluidos,
         costo_unitario_mxn = round(p_costo, 4),
         activo = p_activo,
         updated_at = now(),
         updated_by = auth.uid()
   WHERE proveedor = p_proveedor AND canal = p_canal;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No existe la tarifa % / %', p_proveedor, p_canal;
  END IF;
END
$function$;

-- 6. Pantalla: consumo y costo de un mes -----------------------------------------------------------------
-- Si el mes ya esta cerrado devuelve lo CONGELADO; si no, lo calcula en vivo con las tarifas de hoy.
CREATE OR REPLACE FUNCTION public.resumen_costos_mensajeria(p_anio integer, p_mes integer)
RETURNS TABLE(proveedor text, canal text, usados bigint, incluidos integer, excedente bigint,
              costo_unitario_mxn numeric, costo_mxn numeric, cerrado boolean, gasto_id uuid, gasto_estado text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
BEGIN
  PERFORM messaging_private.require_settings_admin();
  RETURN QUERY
    SELECT t.proveedor,
           t.canal,
           COALESCE(c.usados, u.usados, 0)::bigint,
           COALESCE(c.incluidos, t.incluidos_al_mes),
           COALESCE(c.excedente, greatest(0, COALESCE(u.usados, 0) - t.incluidos_al_mes))::bigint,
           COALESCE(c.costo_unitario_mxn, t.costo_unitario_mxn),
           COALESCE(c.costo_mxn, messaging_private.costo_excedente(COALESCE(u.usados, 0), t.incluidos_al_mes, t.costo_unitario_mxn)),
           (c.id IS NOT NULL),
           c.gasto_id,
           g.estado
      FROM public.tarifas_mensajeria t
      LEFT JOIN messaging_private.uso_mensajeria(p_anio, p_mes) u
        ON u.proveedor = t.proveedor AND u.canal = t.canal
      LEFT JOIN public.cierres_mensajeria c
        ON c.anio = p_anio AND c.mes = p_mes AND c.proveedor = t.proveedor AND c.canal = t.canal
      LEFT JOIN public.gastos_operacion g ON g.id = c.gasto_id
     WHERE t.activo OR c.id IS NOT NULL
     ORDER BY t.canal, t.proveedor;
END
$function$;

-- 7. El cierre mensual -------------------------------------------------------------------------------------
-- Crea, por cada tarifa activa sin cierre, el renglon de cierre y, si hubo costo, UN gasto en BORRADOR en la cuenta 607
-- (fecha: ultimo dia del mes; MXN; sin IVA). Solo meses terminados. Devuelve cuantos gastos creo.
-- Lo corre pg_cron el dia 1 (sin sesion: auth.uid() es nulo) o un usuario con permiso de gastos desde la pantalla.
CREATE OR REPLACE FUNCTION public.cerrar_costos_mensajeria(p_anio integer, p_mes integer)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  r record;
  v_excedente bigint;
  v_costo numeric;
  v_gasto uuid;
  v_creados integer := 0;
  v_periodo text;
  v_fecha date;
  v_proveedor text;
  v_canal text;
  v_unidad text;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.puede_gestionar_gastos() THEN
    RAISE EXCEPTION 'No autorizado para registrar gastos' USING ERRCODE = '42501';
  END IF;
  IF p_anio IS NULL OR p_mes IS NULL OR p_anio NOT BETWEEN 2020 AND 2100 OR p_mes NOT BETWEEN 1 AND 12 THEN
    RAISE EXCEPTION 'Periodo invalido';
  END IF;
  IF make_date(p_anio, p_mes, 1) >= date_trunc('month', now() AT TIME ZONE 'America/Mexico_City')::date THEN
    RAISE EXCEPTION 'Solo se puede cerrar un mes terminado';
  END IF;

  v_periodo := to_char(make_date(p_anio, p_mes, 1), 'YYYY-MM');
  v_fecha := (make_date(p_anio, p_mes, 1) + interval '1 month' - interval '1 day')::date;

  FOR r IN
    SELECT t.proveedor, t.canal, t.incluidos_al_mes, t.costo_unitario_mxn, COALESCE(u.usados, 0) AS usados
      FROM public.tarifas_mensajeria t
      LEFT JOIN messaging_private.uso_mensajeria(p_anio, p_mes) u
        ON u.proveedor = t.proveedor AND u.canal = t.canal
     WHERE t.activo
       AND NOT EXISTS (SELECT 1 FROM public.cierres_mensajeria c
                        WHERE c.anio = p_anio AND c.mes = p_mes AND c.proveedor = t.proveedor AND c.canal = t.canal)
     ORDER BY t.canal, t.proveedor
  LOOP
    v_excedente := greatest(0, r.usados - r.incluidos_al_mes);
    v_costo := messaging_private.costo_excedente(r.usados, r.incluidos_al_mes, r.costo_unitario_mxn);
    v_gasto := NULL;

    IF v_costo > 0 THEN
      v_proveedor := CASE r.proveedor WHEN 'twilio' THEN 'Twilio' WHEN 'labsmobile' THEN 'LabsMobile'
                       WHEN 'smtp2go' THEN 'SMTP2GO' WHEN 'sendgrid' THEN 'SendGrid' WHEN 'zoho' THEN 'Zoho'
                       ELSE r.proveedor END;
      v_canal := CASE r.canal WHEN 'sms' THEN 'SMS' WHEN 'whatsapp' THEN 'WhatsApp' ELSE 'correo' END;
      v_unidad := CASE r.canal WHEN 'sms' THEN 'segmentos' WHEN 'whatsapp' THEN 'mensajes' ELSE 'correos' END;

      INSERT INTO public.gastos_operacion (
        fecha, cuenta_contable, proveedor, descripcion,
        moneda, tipo_cambio, subtotal, iva, total, total_mxn,
        estado, periodo, notas, creado_por
      ) VALUES (
        v_fecha, '607', v_proveedor,
        format('Mensajeria %s %s %s: %s %s enviados, %s sobre los %s incluidos, a $%s MXN cada uno',
               v_canal, v_proveedor, v_periodo, r.usados, v_unidad, v_excedente, r.incluidos_al_mes, r.costo_unitario_mxn),
        'MXN', 1, v_costo, 0, v_costo, v_costo,
        'borrador', v_periodo,
        'Generado por el cierre mensual de mensajeria con la tarifa configurada (estimacion): confirmar contra la factura del proveedor antes de registrarlo. Sin IVA: proveedor extranjero que no emite CFDI, no hay IVA que acreditar.',
        auth.uid()
      ) RETURNING id INTO v_gasto;
      v_creados := v_creados + 1;
    END IF;

    INSERT INTO public.cierres_mensajeria
      (anio, mes, proveedor, canal, usados, incluidos, excedente, costo_unitario_mxn, costo_mxn, gasto_id, creado_por)
    VALUES
      (p_anio, p_mes, r.proveedor, r.canal, r.usados, r.incluidos_al_mes, v_excedente, r.costo_unitario_mxn, v_costo, v_gasto, auth.uid());
  END LOOP;

  RETURN v_creados;
END
$function$;

-- 8. Permisos ----------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION messaging_private.costo_excedente(bigint, integer, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION messaging_private.uso_mensajeria(integer, integer) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.get_tarifas_mensajeria() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guardar_tarifa_mensajeria(text, text, integer, numeric, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.resumen_costos_mensajeria(integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cerrar_costos_mensajeria(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_tarifas_mensajeria() TO authenticated;
GRANT EXECUTE ON FUNCTION public.guardar_tarifa_mensajeria(text, text, integer, numeric, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resumen_costos_mensajeria(integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cerrar_costos_mensajeria(integer, integer) TO authenticated, service_role;

-- 9. Programado: dia 1 de cada mes, 07:00 UTC (01:00 en Ciudad de Mexico), cierra el mes anterior ---------------
-- Solo donde existe pg_cron (no en la base de pruebas de CI).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cerrar-costos-mensajeria') THEN
      PERFORM cron.unschedule('cerrar-costos-mensajeria');
    END IF;
    PERFORM cron.schedule(
      'cerrar-costos-mensajeria',
      '0 7 1 * *',
      $job$SELECT public.cerrar_costos_mensajeria(
             EXTRACT(YEAR FROM (now() AT TIME ZONE 'America/Mexico_City') - interval '1 month')::int,
             EXTRACT(MONTH FROM (now() AT TIME ZONE 'America/Mexico_City') - interval '1 month')::int);$job$
    );
  END IF;
END $$;
