/*
# M-4: las tres `snapshot_*_tax` perdian el error en un WARNING

## El problema

`snapshot_booking_tax`, `snapshot_supplement_tax` y `snapshot_optional_service_tax`
hacen lo mismo ante un fallo:

    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '... fallo para ... %: % (%)', NEW.id, SQLERRM, SQLSTATE;
      NEW.tax_treatment := NULL; ... (los seis campos fiscales a NULL)

El `RAISE WARNING` va a los logs de Postgres, que nadie lee, y el cobro continua con
los campos fiscales vacios. `claude.md` lo tiene documentado como pendiente abierto
para una sola funcion; la auditoria del 05-sep-2026 verifico que son tres.

## Que cambia y que NO cambia

**NO cambia:** el cobro sigue pasando. Bloquearlo seria una decision de negocio
distinta y mas arriesgada —un error en el calculo fiscal detendria todas las ventas—,
y ademas la red de seguridad ya existe: `check_missing_tax_snapshots`
(`20260901064252`) cuenta reservas, suplementos y servicios opcionales sin snapshot y
avisa a los admins.

**Si cambia:** el fallo deja de perderse. Ahora ademas del WARNING se escribe una fila
en `public.audit_errors`, que es consultable, tiene fecha y sobrevive a la rotacion de
logs. La pregunta que plantea el backlog no es "fallar o no fallar" sino "que se hace
visible en el momento", y esto es lo segundo.

## El patron no es nuevo: se copia de `insert_audit_log`

    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '...';
      BEGIN
        INSERT INTO audit_errors (...) VALUES (...);
      EXCEPTION WHEN OTHERS THEN
        NULL;   -- el fallback nunca puede tumbar la transaccion de negocio
      END;

El `BEGIN` anidado con su propio `EXCEPTION ... NULL` es lo que garantiza que dejar el
rastro no pueda romper el cobro que se estaba intentando salvar. Si `audit_errors`
estuviera llena, bloqueada o no existiera, el flujo sigue igual que hoy.

## Como se aplica

Se reescriben las definiciones VIVAS (`pg_get_functiondef`) en vez de pegar aqui una
copia del cuerpo, para no pisar ningun cambio posterior que no estuviera en el repo.
Si el patron de anclaje no aparece en alguna de las tres, la migracion ABORTA en vez
de dejar el trabajo a medias.
*/

DO $migracion$
DECLARE
  v_fn        text;
  v_def       text;
  v_nuevo     text;
  v_ancla     text;
  v_bloque    text;
  v_largo_ant int;
  v_largo_des int;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'snapshot_booking_tax',
    'snapshot_supplement_tax',
    'snapshot_optional_service_tax'
  ] LOOP

    SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = v_fn;

    IF v_def IS NULL THEN
      RAISE EXCEPTION 'No existe public.%', v_fn;
    END IF;

    IF v_def ILIKE '%audit_errors%' THEN
      RAISE NOTICE '% ya deja rastro en audit_errors; se omite', v_fn;
      CONTINUE;
    END IF;

    -- Ancla: la sentencia RAISE WARNING completa, hasta su punto y coma.
    -- Se evita meter parentesis y % en el patron usando [^;]*.
    v_ancla := '(RAISE WARNING ''' || v_fn || ' fallo[^;]*;)';

    IF v_def !~ v_ancla THEN
      RAISE EXCEPTION 'No se encontro el RAISE WARNING esperado en %. La funcion cambio: revisar a mano en vez de parchear a ciegas.', v_fn;
    END IF;

    v_bloque :=
      E'\\1\n' ||
      '    BEGIN' || E'\n' ||
      '      INSERT INTO public.audit_errors (error_message, sqlstate, raw_payload)' || E'\n' ||
      '      VALUES (' || E'\n' ||
      '        format(''' || v_fn || ' fallo para %s: %s'', NEW.id, SQLERRM),' || E'\n' ||
      '        SQLSTATE,' || E'\n' ||
      '        jsonb_build_object(' || E'\n' ||
      '          ''funcion'', ''' || v_fn || ''',' || E'\n' ||
      '          ''fila_id'', NEW.id,' || E'\n' ||
      '          ''tabla'', TG_TABLE_NAME,' || E'\n' ||
      '          ''operacion'', TG_OP,' || E'\n' ||
      '          ''campos_fiscales_anulados'', true' || E'\n' ||
      '        )' || E'\n' ||
      '      );' || E'\n' ||
      '    EXCEPTION WHEN OTHERS THEN' || E'\n' ||
      '      NULL;  -- dejar el rastro nunca puede tumbar el cobro' || E'\n' ||
      '    END;';

    v_nuevo := regexp_replace(v_def, v_ancla, v_bloque);

    v_largo_ant := length(v_def);
    v_largo_des := length(v_nuevo);

    IF v_largo_des <= v_largo_ant THEN
      RAISE EXCEPTION 'El parche de % no agrego nada (% -> % caracteres)', v_fn, v_largo_ant, v_largo_des;
    END IF;

    EXECUTE v_nuevo;
    RAISE NOTICE 'OK %: % -> % caracteres (+%)', v_fn, v_largo_ant, v_largo_des, v_largo_des - v_largo_ant;
  END LOOP;
END
$migracion$;

-- Verificacion final: las tres tienen que dejar rastro ahora.
DO $verif$
DECLARE
  v_faltan text;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO v_faltan
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('snapshot_booking_tax','snapshot_supplement_tax','snapshot_optional_service_tax')
    AND pg_get_functiondef(p.oid) NOT ILIKE '%audit_errors%';

  IF v_faltan IS NOT NULL THEN
    RAISE EXCEPTION 'Estas siguen sin dejar rastro: %', v_faltan;
  END IF;

  RAISE NOTICE 'OK: las tres snapshot_*_tax escriben en audit_errors';
END
$verif$;
