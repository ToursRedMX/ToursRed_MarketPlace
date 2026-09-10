-- Bloquear a un usuario ahora tambien le corta la sesion que ya tenia.
--
-- ============================================================================
-- QUE FALTABA
-- ============================================================================
--
-- El bloqueo (`users.is_active = false`) tenia dos de sus tres piezas:
--
--   #183  el front falla cerrado: un bloqueado no vuelve a entrar.
--   #184  RLS ignora a los bloqueados: aunque tenga token, no lee datos.
--   ----  NADIE revocaba la sesion ya emitida.
--
-- Y el cliente tiene `autoRefreshToken: true`. O sea que a un usuario ya
-- logueado al que se bloquea, su token se renovaba solo, indefinidamente. No
-- podia leer nada —de eso se encarga #184— pero seguia con sesion viva, y eso
-- es exactamente la mitad del control que faltaba: bloquear deberia CORTAR la
-- sesion, no solo negarle datos.
--
-- ============================================================================
-- POR QUE UN TRIGGER Y NO UNA LLAMADA DESDE EL FRONT
-- ============================================================================
--
-- La alternativa era una Edge Function con `auth.admin.signOut()` que el panel
-- llamara despues de bloquear. Se descarto por tres motivos, todos medidos
-- leyendo el codigo:
--
--   1. HAY DOS CAMINOS QUE BLOQUEAN, no uno:
--        - `AdminUsers.tsx:344`  (bloquear a cualquier usuario)
--        - `src/lib/supabase.ts:353` (`updateAgencyStatus`, que ademas del
--          registro de la agencia escribe `users.is_active` del dueno)
--      Con una llamada desde el front habria que acordarse en los dos, y en el
--      tercero que alguien agregue el mes que viene.
--
--   2. No seria atomico. El bloqueo se escribe, la llamada de revocacion puede
--      fallar, y queda un bloqueado con sesion viva y nadie enterado.
--
--   3. No cubre el bloqueo hecho desde el editor SQL del panel de Supabase, que
--      es justo lo que uno hace en una urgencia.
--
-- El trigger cubre los tres casos porque cuelga del dato, no del llamador.
--
-- ============================================================================
-- POR QUE LA REVOCACION NUNCA PUEDE ABORTAR EL BLOQUEO
-- ============================================================================
--
-- Un error dentro de un trigger `AFTER UPDATE` deshace el UPDATE. Si esto se
-- dejara propagar, un fallo revocando —o un cambio de Supabase en el esquema
-- `auth`, que es suyo y lo mueven en las actualizaciones— haria IMPOSIBLE
-- bloquear a nadie. El remedio seria peor que la enfermedad.
--
-- La jerarquia es clara y hay que respetarla:
--
--   El bloqueo es el control PRIMARIO — sin el no hay nada, y ademas es del
--   que cuelga #184. La revocacion es SECUNDARIA: reduce una ventana.
--
-- Asi que el `EXCEPTION` de mas abajo se traga el error a proposito. Es la
-- unica vez en toda esta auditoria que eso es lo correcto, y por eso no queda
-- en silencio: se asienta en `audit_errors` con el usuario y el SQLSTATE, con
-- la misma forma que usan las tres `snapshot_*_tax` (`20260908191141`).
--
-- ============================================================================
-- LO QUE ESTO NO ARREGLA, DICHO CLARO
-- ============================================================================
--
-- Borrar la sesion mata el REFRESH: el token no se renueva mas. Pero el access
-- token JWT que el navegador ya tiene en la mano sigue siendo criptograficamente
-- valido hasta su `exp`, porque un JWT se valida por firma, sin consultar la
-- base. Esa ventana residual —lo que el proyecto tenga configurado como
-- expiracion del token, por defecto 1 hora— no la cierra ni esto ni
-- `auth.admin.signOut()`, que hace exactamente lo mismo por dentro. Cerrarla
-- del todo exige un Auth Hook que valide cada token contra la base, y eso es
-- otra decision, mas cara.
--
-- Dentro de esa ventana el bloqueado ya no lee datos (#184), asi que lo que
-- queda es una sesion aparentemente viva sobre una base que no le responde.
--
-- ============================================================================
-- QUE SE BORRA EXACTAMENTE
-- ============================================================================
--
-- Solo `auth.sessions`. Las dos tablas que dependen de ella se van por CASCADE
-- —verificado contra la base el 10-sep-2026 leyendo pg_constraint—:
--
--   auth.refresh_tokens   FK session_id -> auth.sessions(id)  ON DELETE CASCADE
--   auth.mfa_amr_claims   FK session_id -> auth.sessions(id)  ON DELETE CASCADE
--
-- Y lo que NO se toca, que importa mas: `auth.mfa_factors` cuelga de
-- `auth.users`, no de `auth.sessions`. Borrar sesiones NO desenrola el segundo
-- factor de nadie. Si asi fuera, desbloquear a alguien lo dejaria sin MFA, que
-- seria un agujero abierto por la puerta de atras.
--
-- El DELETE filtra por `user_id` y hay indice para eso —`sessions_user_id_idx`,
-- que trae GoTrue de fabrica—, asi que bloquear no se vuelve mas lento segun
-- crezca la tabla de sesiones.
--
-- Al aplicar esto NO se revoca a nadie retroactivamente: el trigger solo mira
-- transiciones futuras. Medido el 10-sep-2026 contra la base, eso no deja a
-- nadie fuera del alcance porque hoy hay 0 usuarios con is_active = false. Si
-- algun dia se aplicara con bloqueados ya existentes, habria que barrerlos a
-- mano una vez.

DO $migracion$
BEGIN
  -- -------------------------------------------------------------------------
  -- 0. Seguro: si el esquema `auth` no es el que se midio, no inventar.
  -- -------------------------------------------------------------------------
  --
  -- `auth` es de Supabase, no nuestro. Antes que crear un trigger que apunte a
  -- una tabla que no existe —y que fallaria en el peor momento, al bloquear a
  -- alguien de verdad— se aborta y se dice que revisar.
  IF to_regclass('auth.sessions') IS NULL THEN
    RAISE EXCEPTION
      'Abortada: no existe auth.sessions. El esquema de GoTrue cambio; revisa como se revocan sesiones en esta version antes de reintentar.';
  END IF;

  -- -------------------------------------------------------------------------
  -- 1. La funcion del trigger.
  -- -------------------------------------------------------------------------
  --
  -- SECURITY DEFINER porque el rol que ejecuta el UPDATE (un admin via
  -- `authenticated`) no tiene —ni debe tener— permiso de DELETE sobre el
  -- esquema `auth`. La funcion la crea la migracion, o sea `postgres`, que si
  -- lo tiene.
  --
  -- `SET search_path` va explicito porque lo exige la guardia de CI
  -- `check-search-path.mjs`; las referencias a `auth.` van calificadas de todos
  -- modos, que es lo que de verdad evita el secuestro de esquema.
  EXECUTE $ddl$
    CREATE OR REPLACE FUNCTION public.revocar_sesiones_al_bloquear()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
    AS $cuerpo$
    DECLARE
      v_revocadas int := 0;
    BEGIN
      BEGIN
        DELETE FROM auth.sessions WHERE user_id = NEW.id;
        GET DIAGNOSTICS v_revocadas = ROW_COUNT;

        RAISE NOTICE 'Bloqueo de %: % sesion(es) revocada(s).', NEW.id, v_revocadas;
      EXCEPTION WHEN OTHERS THEN
        -- Ver la cabecera: tragarse esto es deliberado. El bloqueo tiene que
        -- quedar escrito aunque la revocacion falle, porque es el control del
        -- que cuelga RLS. Lo que no puede es quedar en silencio.
        INSERT INTO public.audit_errors (error_message, sqlstate, raw_payload)
        VALUES (
          format('revocar_sesiones_al_bloquear fallo para %s: %s', NEW.id, SQLERRM),
          SQLSTATE,
          jsonb_build_object(
            'funcion', 'revocar_sesiones_al_bloquear',
            'usuario_bloqueado', NEW.id,
            'tabla', TG_TABLE_NAME,
            'operacion', TG_OP,
            'consecuencia', 'el usuario quedo bloqueado pero conserva su sesion; revocala a mano'
          )
        );
      END;

      RETURN NEW;
    END
    $cuerpo$;
  $ddl$;

  EXECUTE 'REVOKE EXECUTE ON FUNCTION public.revocar_sesiones_al_bloquear() FROM PUBLIC';

  EXECUTE $c$
    COMMENT ON FUNCTION public.revocar_sesiones_al_bloquear() IS
      'Borra las sesiones de GoTrue de un usuario al bloquearlo (is_active pasa a false). Nunca aborta el UPDATE: si falla, deja rastro en audit_errors.'
  $c$;

  -- -------------------------------------------------------------------------
  -- 2. El trigger, que solo mira la TRANSICION a bloqueado.
  -- -------------------------------------------------------------------------
  --
  -- El `WHEN` importa: sin el, cualquier UPDATE sobre la fila de un bloqueado
  -- —cambiar su telefono, por ejemplo— volveria a borrar sesiones que ya no
  -- existen, y peor, un `UPDATE ... SET is_active = false` masivo cerraria
  -- sesiones ya cerradas una y otra vez.
  --
  -- `OLD.is_active IS DISTINCT FROM false` en vez de `= true` por el mismo
  -- motivo que la migracion `20260909220350`: si alguien quitara el NOT NULL,
  -- la transicion NULL -> false tiene que seguir contando como bloqueo.
  EXECUTE 'DROP TRIGGER IF EXISTS revocar_sesiones_al_bloquear ON public.users';
  EXECUTE $ddl$
    CREATE TRIGGER revocar_sesiones_al_bloquear
    AFTER UPDATE OF is_active ON public.users
    FOR EACH ROW
    WHEN (OLD.is_active IS DISTINCT FROM false AND NEW.is_active = false)
    EXECUTE FUNCTION public.revocar_sesiones_al_bloquear();
  $ddl$;

  RAISE NOTICE 'Listo: bloquear un usuario ahora revoca sus sesiones.';
END $migracion$;
