-- ============================================================================
-- El sexo del viajero se captura, se guarda y llega a la aseguradora.
--
-- QUE ESTABA PASANDO
--
-- El paso 2 del flujo de reserva pide el sexo de cada viajero, lo valida y lo
-- manda en el payload (`sexo: t.sexo || null`). Pero `booking_travelers` NO
-- tiene esa columna y `create_booking_atomic` no menciona `sexo` ni una vez:
-- la clave llegaba al jsonb y se ignoraba en silencio. Las 44 reservas hechas
-- hasta hoy no lo tienen.
--
-- Y el prellenado tampoco funcionaba: el `select` del perfil pide diez
-- columnas y `sexo` no esta entre ellas, asi que a los usuarios que SI lo
-- tienen guardado se les volvia a pedir. Eso es lo que lo destapo.
--
-- POR QUE UN VALOR DESCONOCIDO NO REVIENTA LA RESERVA
--
-- La columna lleva CHECK, igual que `users.sexo`. Pero la funcion NO confia en
-- que el cliente mande algo valido: mapea los tres valores conocidos y
-- cualquier otra cosa la guarda como NULL. Si dependiera solo del CHECK, un
-- front desactualizado que mandara 'M' abortaria la reserva ENTERA por un dato
-- accesorio — cobro incluido. El CHECK se queda como red para escrituras
-- directas, no como la primera linea.
--
-- POR QUE SE PARCHEA Y NO SE REESCRIBE LA FUNCION
--
-- `create_booking_atomic` tiene 743 lineas. Transcribirlas para cambiar dos es
-- la forma mas facil de meter un error invisible — ya paso con la vista de 307
-- lineas de `pagar_gasto_en_parcialidades`, y ahi la leccion fue extraer en vez
-- de copiar. Aqui se sustituyen dos trozos EXACTOS, cada uno verificado como
-- unico antes de tocar nada, y se comprueba el resultado despues.
-- ============================================================================

DO $migracion$
DECLARE
  v_src         text;
  v_nuevo       text;
  -- OJO: son DOS firmas distintas y hacen falta las dos.
  --   identity  -> para LOCALIZAR la funcion; no lleva los DEFAULT.
  --   completa  -> para RECREARLA; SI los lleva, y sin ellos Postgres responde
  --                'cannot remove parameter defaults from existing function'.
  -- Lo cazo la prueba, no la lectura.
  v_identidad   text := 'p_booking_data jsonb, p_travelers jsonb, p_optional_services jsonb, p_session_id text, p_seat_numbers integer[]';
  v_firma       text;
  v_cols_viejo  text := E'categoria_viajero, precio_aplicado,\nemergency_contact_name, emergency_contact_phone\n)';
  v_cols_nuevo  text := E'categoria_viajero, precio_aplicado,\nemergency_contact_name, emergency_contact_phone, sexo\n)';
  v_vals_viejo  text := E'NULLIF(v_traveler->>''emergency_contact_phone'', '''')::text\n);';
  v_vals_nuevo  text := E'NULLIF(v_traveler->>''emergency_contact_phone'', '''')::text,\nCASE WHEN v_traveler->>''sexo'' IN (''masculino'', ''femenino'', ''no_binario'')\n     THEN v_traveler->>''sexo'' ELSE NULL END\n);';
  v_veces       int;
BEGIN
  -- --------------------------------------------------------------------------
  -- 1. Las dos columnas. Mismo dominio que `users.sexo`, comprobado leyendolo.
  -- --------------------------------------------------------------------------
  -- `frequent_companions` la lleva por lo mismo: al elegir un acompanante
  -- frecuente el paso 2 copia once campos, y sin esta columna el sexo seria el
  -- unico que habria que volver a teclear cada vez.
  ALTER TABLE public.booking_travelers   ADD COLUMN IF NOT EXISTS sexo text;
  ALTER TABLE public.frequent_companions ADD COLUMN IF NOT EXISTS sexo text;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.booking_travelers'::regclass
                    AND conname  = 'booking_travelers_sexo_check') THEN
    ALTER TABLE public.booking_travelers
      ADD CONSTRAINT booking_travelers_sexo_check
      CHECK (sexo IS NULL OR sexo IN ('masculino', 'femenino', 'no_binario'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.frequent_companions'::regclass
                    AND conname  = 'frequent_companions_sexo_check') THEN
    ALTER TABLE public.frequent_companions
      ADD CONSTRAINT frequent_companions_sexo_check
      CHECK (sexo IS NULL OR sexo IN ('masculino', 'femenino', 'no_binario'));
  END IF;

  -- --------------------------------------------------------------------------
  -- 2. El parche de `create_booking_atomic`.
  -- --------------------------------------------------------------------------
  SELECT p.prosrc, pg_get_function_arguments(p.oid) INTO v_src, v_firma
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'create_booking_atomic'
     AND pg_get_function_identity_arguments(p.oid) = v_identidad;

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'Abortada: no existe create_booking_atomic(%). Revisa la cadena de migraciones.', v_identidad;
  END IF;

  -- Si ya esta parcheada, no se toca: la migracion es reaplicable.
  IF position('''sexo''' in v_src) > 0 THEN
    RAISE NOTICE 'create_booking_atomic ya escribe el sexo; no se toca.';
  ELSE
    -- Cada objetivo TIENE que aparecer exactamente una vez. Un replace sobre un
    -- texto ambiguo cambiaria un sitio que nadie reviso.
    v_veces := (length(v_src) - length(replace(v_src, v_cols_viejo, ''))) / length(v_cols_viejo);
    IF v_veces <> 1 THEN
      RAISE EXCEPTION 'Abortada: la lista de columnas del INSERT aparece % veces, se esperaba 1.', v_veces;
    END IF;

    v_veces := (length(v_src) - length(replace(v_src, v_vals_viejo, ''))) / length(v_vals_viejo);
    IF v_veces <> 1 THEN
      RAISE EXCEPTION 'Abortada: la lista de valores del INSERT aparece % veces, se esperaba 1.', v_veces;
    END IF;

    v_nuevo := replace(replace(v_src, v_cols_viejo, v_cols_nuevo), v_vals_viejo, v_vals_nuevo);

    IF v_nuevo = v_src THEN
      RAISE EXCEPTION 'Abortada: el reemplazo no cambio nada.';
    END IF;

    -- CREATE OR REPLACE conserva los GRANT. Se repiten los atributos porque
    -- omitir uno los pierde: sin SECURITY DEFINER la funcion dejaria de poder
    -- escribir, y sin `SET search_path` la guardia de CI la marcaria en rojo.
    EXECUTE format(
      'CREATE OR REPLACE FUNCTION public.create_booking_atomic(%s) '
      'RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS %L',
      v_firma, v_nuevo);
  END IF;

  -- --------------------------------------------------------------------------
  -- 3. Y se comprueba que quedo como debe.
  -- --------------------------------------------------------------------------
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='booking_travelers' AND column_name='sexo') THEN
    RAISE EXCEPTION 'Abortada: booking_travelers.sexo no quedo creada.';
  END IF;

  SELECT p.prosrc INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='create_booking_atomic'
     AND pg_get_function_identity_arguments(p.oid) = v_identidad;

  IF position('sexo' in v_src) = 0 THEN
    RAISE EXCEPTION 'Abortada: create_booking_atomic sigue sin escribir el sexo.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                  WHERE n.nspname='public' AND p.proname='create_booking_atomic'
                    AND p.prosecdef AND p.proconfig @> ARRAY['search_path=public']) THEN
    RAISE EXCEPTION 'Abortada: la funcion perdio SECURITY DEFINER o su search_path.';
  END IF;

  RAISE NOTICE 'Listo: booking_travelers.sexo y frequent_companions.sexo creadas, y create_booking_atomic las escribe.';
END $migracion$;

COMMENT ON COLUMN public.booking_travelers.sexo IS
  'Sexo declarado por el viajero. Lo pide la aseguradora y se usa en estadisticas. Mismo dominio que users.sexo; NULL cuando no se capturo o el cliente mando un valor desconocido.';
COMMENT ON COLUMN public.frequent_companions.sexo IS
  'Sexo del acompanante frecuente, para no volver a teclearlo en cada reserva. Mismo dominio que users.sexo.';
