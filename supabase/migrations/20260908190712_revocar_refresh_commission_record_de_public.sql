/*
# M-3: `refresh_commission_record` era invocable por cualquiera

## El problema

`public.refresh_commission_record(uuid)` es SECURITY DEFINER, recibe un
`p_booking_id` arbitrario y no tiene ningun chequeo de identidad. Su ACL:

    =X/postgres          <- PUBLIC
    postgres=X/postgres
    anon=X/postgres
    authenticated=X/postgres
    service_role=X/postgres

O sea que estaba expuesta a **PUBLIC y a `anon`**, no solo a `authenticated`
como decia la auditoria del 05-sep-2026. Cualquiera con la llave publicable
podia forzar el recalculo de la fila de comisiones de una reserva ajena
(IDOR). No permite inyectar importes —recalcula desde fuentes autoritativas—,
pero pisa cualquier ajuste manual que hubiera sobre esa fila.

## Por que se REVOCA en vez de anadir un chequeo de autorizacion

Copiar el patron de sus funciones hermanas
(`20260820204143_add_authorization_checks_to_security_definer_functions.sql`),
que es `IF auth.uid() IS NOT NULL AND NOT public.is_admin_user() THEN RAISE`,
**habria roto las reservas en produccion**.

`auth.uid()` lee `request.jwt.claims`, que es una GUC de la sesion.
SECURITY DEFINER cambia el rol de base de datos, NO esa GUC. Asi que dentro de
un trigger disparado por un viajero, `auth.uid()` sigue devolviendo al viajero.
Un chequeo "tiene que ser admin" lanzaria excepcion en cada
INSERT sobre `booking_optional_services`, `booking_supplements` y
`booking_payment_plan_transactions`, tumbando la transaccion de negocio.

## Por que revocar es seguro

Nadie la llama directamente. Se comprobo:

  - `grep -rn refresh_commission_record src/`                -> 0
  - `grep -rn refresh_commission_record supabase/functions/` -> 0

Sus unicos llamadores viven dentro de la base, y todos son SECURITY DEFINER
propiedad de `postgres`, asi que la llaman con los privilegios de `postgres`:

  - `create_commission_record`                (trigger sobre `bookings`)
  - `refresh_commission_on_optional_service`  (trigger sobre `booking_optional_services`)
  - `refresh_commission_on_supplement`        (trigger sobre `booking_supplements`)
  - `refresh_commission_on_payment_plan_txn`  (trigger sobre `booking_payment_plan_transactions`)
  - `create_accounting_entry_for_tour_completion`

La prueba de que un trigger no necesita el GRANT esta en la propia base:
`create_commission_record` se dispara en CADA reserva que crea un viajero y su
ACL es `postgres=X | service_role=X` —sin `authenticated`, sin PUBLIC— y
funciona. El mecanismo de triggers no comprueba EXECUTE sobre la funcion.

Se conserva `service_role` para igualar a esas funciones hermanas y no cerrar
un camino de operacion; el service role ya puede hacer cualquier cosa.
*/

REVOKE ALL ON FUNCTION public.refresh_commission_record(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refresh_commission_record(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.refresh_commission_record(uuid) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.refresh_commission_record(uuid) TO service_role;

-- Verificacion: falla ruidosamente si el ACL no quedo como se espera.
DO $$
DECLARE
  v_acl text[];
  v_sobra text;
BEGIN
  SELECT p.proacl::text[] INTO v_acl
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'refresh_commission_record';

  IF v_acl IS NULL THEN
    RAISE EXCEPTION 'refresh_commission_record quedo sin ACL explicita, o sea abierta a PUBLIC otra vez';
  END IF;

  SELECT string_agg(a, ', ') INTO v_sobra
  FROM unnest(v_acl) a
  WHERE a LIKE 'anon=%' OR a LIKE 'authenticated=%' OR a LIKE '=%';

  IF v_sobra IS NOT NULL THEN
    RAISE EXCEPTION 'refresh_commission_record sigue expuesta a: %', v_sobra;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM unnest(v_acl) a WHERE a LIKE 'service_role=%') THEN
    RAISE EXCEPTION 'se perdio el permiso de service_role sobre refresh_commission_record';
  END IF;

  RAISE NOTICE 'OK: refresh_commission_record queda en %', array_to_string(v_acl, ' | ');
END $$;
