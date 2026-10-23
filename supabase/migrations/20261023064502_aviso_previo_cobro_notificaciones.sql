-- Aviso por correo ANTES de que empiece el cobro de las notificaciones.
--
-- Pedido de Axel (22-oct-2026): avisar a los usuarios con tiempo de que los avisos por SMS pasan a ser una suscripcion. Hasta ahora
-- solo avisaba la tarjeta del perfil (que el usuario tiene que abrir para verla).
--
-- A QUIEN SE AVISA (solo a quien de verdad perderia algo, para no mandar correo a quien nunca uso los SMS):
--   * viajero: tiene encendido alguno de sus tres avisos, telefono verificado, y NO estara cubierto (ni ToursRed Plus ni suscripcion);
--   * agencia: el DUENO, si el dueno o alguien de su personal activo tiene encendido algun aviso de agencia, y la agencia NO tiene
--     suscripcion. La agencia paga una vez y eso cubre a todos; por eso el correo va al dueno, no a cada persona del personal.
--   Se calcula como si el cobro YA estuviera vigente (la cobertura real devuelve «gratis» mientras el cobro no empieza).
--
-- QUIEN YA RECIBIO el aviso para esa fecha de inicio no vuelve a recibirlo (avisos_cobro_notificaciones, una fila por persona y fecha):
-- si Axel cambia la fecha, el aviso es otro y se manda de nuevo; si solo reintenta, no se duplica.
--
-- El envio vive en la Edge Function send-aviso-cobro-notificaciones (solo admin). Esta migracion deja la tabla y la audiencia.

-- 1. Quien recibio el aviso ----------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.avisos_cobro_notificaciones (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  tipo         text NOT NULL,
  agency_id    uuid REFERENCES public.agencies(id) ON DELETE CASCADE,
  correo       text NOT NULL,
  fecha_inicio timestamptz NOT NULL,
  enviado_en   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT avisos_cobro_notificaciones_tipo_check CHECK (tipo IN ('viajero', 'agencia')),
  CONSTRAINT avisos_cobro_notificaciones_unico UNIQUE (user_id, tipo, fecha_inicio)
);

ALTER TABLE public.avisos_cobro_notificaciones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.avisos_cobro_notificaciones FROM PUBLIC, anon;
GRANT SELECT ON public.avisos_cobro_notificaciones TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.avisos_cobro_notificaciones TO service_role;

-- Solo un administrador los ve; las escrituras son de la Edge Function (service role).
DROP POLICY IF EXISTS "Admin lee los avisos del cobro de notificaciones" ON public.avisos_cobro_notificaciones;
CREATE POLICY "Admin lee los avisos del cobro de notificaciones" ON public.avisos_cobro_notificaciones
  FOR SELECT TO authenticated USING (public.is_admin_user());

-- 2. La audiencia -----------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.audiencia_aviso_cobro_notificaciones()
RETURNS TABLE (user_id uuid, tipo text, agency_id uuid, email text, nombre text, agencia text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
  WITH ajustes AS (
    SELECT s.cobro_notificaciones_desde AS desde FROM public.platform_settings s LIMIT 1
  ),
  viajeros AS (
    SELECT u.id AS user_id, 'viajero'::text AS tipo, NULL::uuid AS agency_id, u.email, u.first_name AS nombre, NULL::text AS agencia
      FROM public.users u
      JOIN messaging_private.notification_preferences np
        ON np.user_id = u.id AND np.application = 'toursred' AND np.channel = 'sms'
     WHERE (np.viajero_confirmacion OR np.viajero_cancelacion OR np.viajero_recordatorio)
       AND COALESCE(u.is_active, false) AND u.phone_verified_at IS NOT NULL AND COALESCE(u.email, '') <> ''
       -- Como si el cobro YA estuviera vigente: Plus, o suscripcion viva, o en gracia; si no, perderia los avisos.
       AND messaging_private.decidir_cobertura(
             true,
             public.has_active_membership(u.id),
             EXISTS (SELECT 1 FROM public.suscripciones_notificaciones x
                      WHERE x.tipo = 'viajero' AND x.user_id = u.id
                        AND x.status IN ('active', 'trialing') AND x.current_period_end + interval '1 day' > now()),
             EXISTS (SELECT 1 FROM public.suscripciones_notificaciones x
                      WHERE x.tipo = 'viajero' AND x.user_id = u.id AND x.en_gracia_hasta > now())
           ) IS NULL
  ),
  agencias AS (
    SELECT u.id AS user_id, 'agencia'::text AS tipo, a.id AS agency_id, u.email, u.first_name AS nombre, a.name AS agencia
      FROM public.agencies a
      JOIN public.users u ON u.id = a.user_id
     WHERE COALESCE(u.is_active, false) AND COALESCE(u.email, '') <> ''
       -- El dueno O alguien del personal activo tiene encendido algun aviso de agencia.
       AND EXISTS (
         SELECT 1 FROM messaging_private.notification_preferences np
          WHERE np.application = 'toursred' AND np.channel = 'sms'
            AND (np.agencia_reserva OR np.agencia_cancelacion OR np.agencia_mensaje)
            AND (np.user_id = a.user_id
                 OR np.user_id IN (SELECT st.user_id FROM public.agency_staff st WHERE st.agency_id = a.id AND st.is_active)))
       AND messaging_private.decidir_cobertura(
             true,
             false,
             EXISTS (SELECT 1 FROM public.suscripciones_notificaciones x
                      WHERE x.tipo = 'agencia' AND x.agency_id = a.id
                        AND x.status IN ('active', 'trialing') AND x.current_period_end + interval '1 day' > now()),
             EXISTS (SELECT 1 FROM public.suscripciones_notificaciones x
                      WHERE x.tipo = 'agencia' AND x.agency_id = a.id AND x.en_gracia_hasta > now())
           ) IS NULL
  ),
  todos AS (SELECT * FROM viajeros UNION ALL SELECT * FROM agencias)
  SELECT t.user_id, t.tipo, t.agency_id, t.email, t.nombre, t.agencia
    FROM todos t, ajustes
   WHERE ajustes.desde IS NOT NULL
     -- Quien ya recibio el aviso para ESTA fecha de inicio no lo recibe otra vez.
     AND NOT EXISTS (SELECT 1 FROM public.avisos_cobro_notificaciones v
                      WHERE v.user_id = t.user_id AND v.tipo = t.tipo AND v.fecha_inicio = ajustes.desde)
   ORDER BY t.tipo, t.email;
$function$;

REVOKE ALL ON FUNCTION public.audiencia_aviso_cobro_notificaciones() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.audiencia_aviso_cobro_notificaciones() TO service_role;
