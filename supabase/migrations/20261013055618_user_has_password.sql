-- ¿La cuenta tiene contraseña? Lo necesita set-password (Edge Function) para decidir si el cambio exige
-- reautenticación.
--
-- Contexto (13-oct-2026): cambiar la contraseña desde la app solo comprobaba la contraseña actual EN EL NAVEGADOR
-- (ChangePasswordSection); `supabase.auth.updateUser({ password })` no la pide, así que quien tuviera un token de
-- sesión podía cambiarla sin conocerla. Ahora el cambio pasa por la Edge Function `set-password`, que exige la
-- reautenticación única (TOTP si hay MFA, si no la contraseña actual). Una cuenta creada con Google, Microsoft,
-- X, Facebook o LinkedIn NO tiene contraseña hasta que completa el alta: ahí no hay contraseña actual que pedir.
--
-- Solo service_role. Lee auth.users.encrypted_password pero devuelve únicamente un booleano.
--
-- Rollback: drop function public.user_has_password(uuid);

create function public.user_has_password(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from auth.users
     where id = p_user and coalesce(encrypted_password, '') <> ''
  );
$$;
revoke all on function public.user_has_password(uuid) from public, anon, authenticated;
grant execute on function public.user_has_password(uuid) to service_role;
