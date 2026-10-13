-- Reautenticación única para acciones sensibles (PR de login por teléfono).
--
-- La regla, decidida por Axel el 13-oct-2026 y aplicada AQUÍ, en el servidor:
--   cuenta CON MFA (TOTP verificado) -> solo vale un código TOTP reciente;
--   cuenta SIN MFA                   -> solo vale la contraseña actual, verificada hace poco.
--
-- Qué había antes (verificado contra la base el 13-oct-2026):
--   messaging_private.recent_phone_auth() daba por buena una sesión iniciada hace < 10 min
--   OR cualquier fila vigente de sensitive_verifications. Sin contraseña de por medio:
--   una sesión robada en sus primeros 10 minutos cambiaba el teléfono verificado.
--
-- Por qué la prueba por contraseña va en una tabla APARTE y no en sensitive_verifications:
--   checkStepUp() acepta CUALQUIER fila vigente de esa tabla sin mirar `method`. Una prueba
--   por contraseña guardada ahí abriría el pago con ToursRed Cash (que exige MFA) con solo
--   la contraseña. (Las 11 filas existentes son todas method='totp'.) Esta migración no
--   toca sensitive_verifications; el filtro por method vive en stepUpCheck.ts.
--
-- Rollback: volver a aplicar recent_phone_auth de 20261008054539_phone_otp_enforcement.sql
-- y `drop table public.reauth_proofs`; las dos funciones nuevas se pueden borrar sin más.

create table public.reauth_proofs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  method text not null check (method = 'password'),
  verified_at timestamptz not null default now(),
  expires_at timestamptz not null check (expires_at > verified_at)
);
create index reauth_proofs_user_expires_idx on public.reauth_proofs (user_id, expires_at desc);
-- Solo el service_role (Edge Functions) la escribe y la lee: RLS activado y SIN políticas.
alter table public.reauth_proofs enable row level security;
revoke all on table public.reauth_proofs from public, anon, authenticated;

create function public.user_has_totp(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from auth.mfa_factors
    where user_id = p_user and factor_type = 'totp' and status = 'verified'
  );
$$;
revoke all on function public.user_has_totp(uuid) from public, anon, authenticated;
grant execute on function public.user_has_totp(uuid) to service_role;

-- ¿Hay una reautenticación vigente que cumpla la regla para ESTA cuenta?
-- Con TOTP solo cuenta el TOTP; sin TOTP solo cuenta la contraseña. Nunca se mezclan:
-- una contraseña no sustituye al segundo factor de quien lo tiene.
create function public.reauth_satisfied(p_user uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_user is null then return false; end if;
  if public.user_has_totp(p_user) then
    return exists (
      select 1 from public.sensitive_verifications
      where user_id = p_user and method = 'totp' and expires_at > now()
    );
  end if;
  return exists (
    select 1 from public.reauth_proofs
    where user_id = p_user and method = 'password' and expires_at > now()
  );
end $$;
revoke all on function public.reauth_satisfied(uuid) from public, anon, authenticated;
grant execute on function public.reauth_satisfied(uuid) to service_role;

-- Misma firma, mismo dueño, mismos llamadores (guard_phone_number_change e
-- issue_phone_challenge): solo cambia la condición. Se quita el atajo de
-- "last_sign_in_at < 10 minutos".
create or replace function messaging_private.recent_phone_auth(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.reauth_satisfied(p_user);
$$;
