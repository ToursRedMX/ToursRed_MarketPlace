-- Prueba de TOTP de UN SOLO USO para gastar ToursRed Cash o puntos.
--
-- Decision de Axel, 13-oct-2026: "que lo pida siempre para poder usar wallet y/o puntos".
--
-- Lo que habia (medido contra la base el 13-oct-2026): una verificacion de TOTP valia 15
-- minutos para CUALQUIER accion, y era por persona, no por sesion. Axel verifico el codigo
-- para cancelar una reserva a las 03:01:28 y a las 03:02:16 se debito su Cash sin volver a
-- pedirlo. Eso era el diseno, no un fallo, pero deja abierta la puerta: con el codigo
-- escrito una vez, cualquier sesion de esa cuenta gastaba saldo durante 15 minutos.
--
-- Lo que hay ahora:
--   * `purpose = 'spend'`  -> prueba EXCLUSIVA para gastar saldo/puntos. Vence en 5 minutos y
--                             se CONSUME al usarse: cada gasto exige un codigo nuevo.
--   * `purpose = 'reauth'` -> la de siempre (15 min, reutilizable), SOLO para las acciones
--                             sensibles que no mueven dinero (cancelar, cambiar telefono...).
-- Una prueba de un tipo NO sirve para el otro: el codigo que se tecleo para cancelar no abre
-- un pago, y el de un pago no sirve para cancelar.
--
-- Las filas que ya existen quedan como 'reauth' (default), que es lo que eran.
--
-- ORDEN DE PUESTA EN MARCHA: esta migracion ANTES que las funciones. Las funciones que gastan
-- saldo fallan cerrado: sin `consume_spend_step_up` nadie puede pagar con wallet o puntos.
--
-- Rollback: volver a aplicar `reauth_satisfied` de 20261013014305 (sin el filtro de purpose),
-- `drop function public.consume_spend_step_up(uuid)` y quitar las dos columnas.

alter table public.sensitive_verifications
  add column if not exists purpose text not null default 'reauth',
  add column if not exists consumed_at timestamptz;

alter table public.sensitive_verifications
  add constraint sensitive_verifications_purpose_check check (purpose in ('reauth', 'spend'));

create index if not exists sensitive_verifications_spend_idx
  on public.sensitive_verifications (user_id, expires_at desc)
  where purpose = 'spend' and consumed_at is null;

-- Consume, de forma atomica, la prueba de gasto vigente mas reciente. true = habia una y ya
-- no sirve para otro gasto. `for update skip locked`: dos pagos simultaneos con UN solo codigo
-- no pueden gastarla los dos.
create function public.consume_spend_step_up(p_user uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if p_user is null then return false; end if;
  select id into v_id
    from public.sensitive_verifications
   where user_id = p_user and method = 'totp' and purpose = 'spend'
     and consumed_at is null and expires_at > now()
   order by verified_at desc
   limit 1
   for update skip locked;
  if v_id is null then return false; end if;
  update public.sensitive_verifications set consumed_at = now() where id = v_id and consumed_at is null;
  return found;
end $$;
revoke all on function public.consume_spend_step_up(uuid) from public, anon, authenticated;
grant execute on function public.consume_spend_step_up(uuid) to service_role;

-- La reautenticacion de acciones no monetarias solo cuenta pruebas 'reauth'. Resto igual a
-- 20261013014305.
create or replace function public.reauth_satisfied(p_user uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_user is null then return false; end if;
  if public.user_has_totp(p_user) then
    return exists (
      select 1 from public.sensitive_verifications
      where user_id = p_user and method = 'totp' and purpose = 'reauth' and expires_at > now()
    );
  end if;
  return exists (
    select 1 from public.reauth_proofs
    where user_id = p_user and method = 'password' and expires_at > now()
  );
end $$;
