-- Cierra el acceso de `anon` a nueve funciones SECURITY DEFINER que no tienen razon de ser publicas (advisor de Supabase, 30-oct-2026).
--
-- Contexto: de las 20 funciones definer que `anon` podia ejecutar, 11 son del catalogo publico y del registro (disponibilidad, CURP,
-- correo, pasaporte, slug, baja de alertas) y se quedan abiertas a proposito. Estas nueve no:
--
--   calculate_booking_breakdown, create_booking_atomic_with_preventa, preview_booking_breakdown, complete_agency_onboarding
--       Ya rechazan en su cuerpo cuando `auth.uid()` no coincide, y el front las llama con sesion. `anon` solo conseguia un error;
--       cerrarlo quita ruido y una superficie que no hace falta.
--   release_seat_holds
--       Borra los asientos apartados de CUALQUIER session_id que se le pase. Desde el #484 `hold_seats` exige sesion, asi que quien
--       aparta ya esta autenticado y quien libera tambien.
--   check_preventa_eligibility
--       Nadie la llama desde el front ni desde las Edge Functions; la usa `create_booking_atomic_with_preventa`, que es definer y la
--       ejecuta como su dueno. Se conserva para `authenticated` por si una prueba la invoca.
--   expire_unpaid_approved_bookings
--       La llama un cron cada 15 minutos (como postgres). Con `anon` abierta, cualquiera con la llave publica podia disparar la
--       cancelacion masiva de reservas aprobadas vencidas y sus notificaciones. Queda solo para service_role.
--   prevent_delete_of_used_tour_promotion, reactivar_participantes_al_recibir_mensaje
--       Funciones de trigger: no son RPC. Para dispararlas no hace falta EXECUTE, solo para crear el trigger.
--
-- `REVOKE ... FROM anon` solo NO alcanza: el permiso por omision lo da PUBLIC, y anon lo hereda. Por eso se revoca de PUBLIC y despues
-- se concede explicitamente a quien si lo necesita (mismo patron que ya tienen las funciones contables, ACL = postgres + service_role).
--
-- NO se tocan, a proposito:
--   increment_featured_stat   el front la llama sin sesion para contar impresiones y clics de los tours destacados; cerrarla rompe el
--                             conteo. El riesgo (inflar una estadistica) es menor; se resuelve con un limite, no con un revoke.
--   las 11 del catalogo/registro  ver arriba.

DO $$
DECLARE
  r record;
  v_procesadas integer := 0;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args, v.mantener_authenticated
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN (VALUES
      ('calculate_booking_breakdown',                 true),
      ('create_booking_atomic_with_preventa',         true),
      ('preview_booking_breakdown',                   true),
      ('complete_agency_onboarding',                  true),
      ('release_seat_holds',                          true),
      ('check_preventa_eligibility',                  true),
      ('expire_unpaid_approved_bookings',             false),
      ('prevent_delete_of_used_tour_promotion',       false),
      ('reactivar_participantes_al_recibir_mensaje',  false)
    ) AS v(nombre, mantener_authenticated) ON v.nombre = p.proname
    WHERE n.nspname = 'public'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon, authenticated', r.proname, r.args);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO service_role', r.proname, r.args);
    IF r.mantener_authenticated THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated', r.proname, r.args);
    END IF;

    -- Se comprueba contra la base, no contra lo que se escribio (patron 13 de CLAUDE.md).
    IF has_function_privilege('anon', r.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'anon sigue pudiendo ejecutar public.%(%)', r.proname, r.args;
    END IF;
    IF NOT has_function_privilege('service_role', r.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'service_role perdio el permiso de public.%(%)', r.proname, r.args;
    END IF;
    IF r.mantener_authenticated AND NOT has_function_privilege('authenticated', r.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'authenticated perdio el permiso de public.%(%)', r.proname, r.args;
    END IF;

    v_procesadas := v_procesadas + 1;
  END LOOP;

  -- Si alguna funcion cambio de nombre o desaparecio, que no pase en silencio.
  IF v_procesadas <> 9 THEN
    RAISE EXCEPTION 'Se esperaban 9 funciones y se procesaron %', v_procesadas;
  END IF;
END
$$;
