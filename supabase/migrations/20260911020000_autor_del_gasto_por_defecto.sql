-- ============================================================================
-- Quien captura un gasto queda registrado, lo mande el cliente o no
-- ============================================================================
--
-- `gastos_operacion.creado_por` y `gastos_recurrentes.creado_por` existen desde
-- `20260910240000`, y NADIE las llenaba: el insert de `/admin/gastos` no las
-- mandaba, asi que toda captura nacia con el autor en NULL. Comprobado el
-- 11-sep-2026 sobre la PRIMERA captura real (una factura de TikTok del 01-jul):
-- `creado_por` nulo.
--
-- No es cosmetico. `gastos_operacion` NO tiene trigger de auditoria — a
-- diferencia de `payment_transactions` —, asi que `creado_por` es el unico
-- rastro de quien metio un gasto. Y el permiso `can_manage_expenses` esta hecho
-- justamente para darselo a alguien que no es el super admin: el mismo dia se
-- le otorgo a un usuario. Sin esto, un gasto capturado por esa persona es
-- indistinguible de uno capturado por cualquier otra.
--
-- ----------------------------------------------------------------------------
-- POR QUE UN DEFAULT Y NO SOLO ARREGLAR EL FRONTEND
-- ----------------------------------------------------------------------------
--
-- El frontend tambien se arreglo, pero eso solo cubre al cliente de hoy. Un
-- DEFAULT cubre a cualquiera que escriba en la tabla: la pantalla actual, la
-- que se escriba el año que viene, un script de importacion, una carga masiva.
-- Es la misma leccion del hueco de la comision: la regla tiene que vivir donde
-- no se pueda olvidar, no en cada llamador.
--
-- `auth.uid()` devuelve NULL cuando no hay sesion —service role, cron,
-- `supabase db push`—, asi que el DEFAULT no rompe esas escrituras: quedan en
-- NULL igual que hoy, que es lo correcto porque no hay persona detras. Es el
-- mismo criterio que `insert_audit_log` con el contexto HTTP.
--
-- ----------------------------------------------------------------------------
-- LO QUE NO HACE
-- ----------------------------------------------------------------------------
--
-- No rellena las filas viejas. La unica que existe al 11-sep-2026 se capturo
-- desde el panel con la sesion de Axel, pero eso NO consta en la base, y
-- escribir un autor deducido de una conversacion seria inventar un dato de
-- auditoria. Se queda en NULL, que es la verdad: no se registro.
--
-- Tampoco se pone NOT NULL: eso romperia el generador de recurrentes, que corre
-- por RPC y ya asigna el autor a mano, y cualquier carga por service role.
-- ============================================================================

ALTER TABLE public.gastos_operacion
  ALTER COLUMN creado_por SET DEFAULT auth.uid();

ALTER TABLE public.gastos_recurrentes
  ALTER COLUMN creado_por SET DEFAULT auth.uid();

COMMENT ON COLUMN public.gastos_operacion.creado_por IS
  'Quien capturo el gasto. DEFAULT auth.uid(): se llena solo aunque el cliente '
  'no lo mande. NULL significa que no hubo sesion (service role, cron), no que '
  'se desconozca al autor de una captura manual.';

COMMENT ON COLUMN public.gastos_recurrentes.creado_por IS
  'Quien creo la plantilla. DEFAULT auth.uid(), misma regla que gastos_operacion.';

-- Asercion: el DEFAULT quedo puesto en las dos. Si una migracion futura lo
-- quita, esto falla aqui y no meses despues con una tabla llena de nulos.
DO $$
DECLARE
  v_faltantes text;
BEGIN
  SELECT string_agg(c.table_name || '.' || c.column_name, ', ')
    INTO v_faltantes
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name IN ('gastos_operacion', 'gastos_recurrentes')
    AND c.column_name = 'creado_por'
    AND coalesce(c.column_default, '') NOT LIKE '%auth.uid()%';

  IF v_faltantes IS NOT NULL THEN
    RAISE EXCEPTION 'Sin DEFAULT auth.uid() en: %', v_faltantes;
  END IF;
END $$;
