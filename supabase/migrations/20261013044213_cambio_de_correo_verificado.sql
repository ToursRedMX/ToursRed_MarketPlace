-- Cambio de correo con verificacion del correo NUEVO.
--
-- Antes (verificado el 13-oct-2026): la app no tenia forma de cambiar el correo de una cuenta. Axel
-- pidio que cambiar correo o telefono exija reautenticacion (TOTP si hay MFA, si no la contraseña) y
-- que el valor nuevo se verifique antes de darse por bueno.
--
-- Flujo: request-email-change (reautenticacion + codigo de 6 digitos al correo NUEVO) ->
-- confirm-email-change (codigo bueno -> auth.admin.updateUserById, aviso al correo ANTERIOR).
-- El correo vigente no se toca hasta que el codigo se confirma.
--
-- El codigo se guarda como HMAC (nunca en claro), vence en 15 minutos, admite 5 intentos, y solo
-- hay 3 solicitudes por hora por cuenta. Solo service_role toca esta tabla.
--
-- Rollback: drop function public.issue_email_change(uuid,text,text), public.confirm_email_change(uuid,text);
--           drop table public.email_change_requests;

create table public.email_change_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  new_email text not null check (new_email = lower(new_email) and length(new_email) <= 254),
  code_hash text not null check (code_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  attempts smallint not null default 0 check (attempts between 0 and 5),
  consumed_at timestamptz,
  check (expires_at > created_at)
);
create index email_change_requests_user_idx on public.email_change_requests (user_id, created_at desc);
alter table public.email_change_requests enable row level security;
revoke all on public.email_change_requests from public, anon, authenticated;
grant select, insert, update, delete on public.email_change_requests to service_role;

-- Emite una solicitud. Invalida las anteriores sin consumir (solo una vale a la vez).
create function public.issue_email_change(p_user uuid, p_new_email text, p_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(btrim(p_new_email)); v_id uuid; v_exp timestamptz := now() + interval '15 minutes';
begin
  if p_user is null or v_email is null or v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or length(v_email) > 254 then
    return jsonb_build_object('ok', false, 'code', 'EMAIL_INVALID');
  end if;
  -- Serializa por cuenta: dos solicitudes simultaneas no pueden saltarse el tope.
  perform 1 from auth.users where id = p_user for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'EMAIL_INVALID'); end if;
  if (select count(*) from public.email_change_requests where user_id = p_user and created_at > now() - interval '1 hour') >= 3 then
    return jsonb_build_object('ok', false, 'code', 'EMAIL_CHANGE_RATE_LIMIT');
  end if;
  update public.email_change_requests set consumed_at = now() where user_id = p_user and consumed_at is null;
  insert into public.email_change_requests (user_id, new_email, code_hash, expires_at)
    values (p_user, v_email, p_hash, v_exp) returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'expires_at', v_exp);
end $$;
revoke all on function public.issue_email_change(uuid, text, text) from public, anon, authenticated;
grant execute on function public.issue_email_change(uuid, text, text) to service_role;

-- Confirma el codigo. Devuelve el correo nuevo SOLO con codigo bueno; un solo uso; 5 intentos.
create function public.confirm_email_change(p_user uuid, p_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.email_change_requests;
begin
  if p_user is null or p_hash is null or p_hash !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('ok', false, 'code', 'CODE_INVALID');
  end if;
  select * into r from public.email_change_requests
   where user_id = p_user and consumed_at is null
   order by created_at desc limit 1 for update;
  if r.id is null then return jsonb_build_object('ok', false, 'code', 'CODE_INVALID'); end if;
  if r.expires_at <= now() then
    update public.email_change_requests set consumed_at = now() where id = r.id;
    return jsonb_build_object('ok', false, 'code', 'CODE_EXPIRED');
  end if;
  if r.attempts >= 5 then
    update public.email_change_requests set consumed_at = now() where id = r.id;
    return jsonb_build_object('ok', false, 'code', 'CODE_LOCKED');
  end if;
  update public.email_change_requests set attempts = attempts + 1 where id = r.id;
  if r.code_hash <> p_hash then
    if r.attempts + 1 >= 5 then
      update public.email_change_requests set consumed_at = now() where id = r.id;
      return jsonb_build_object('ok', false, 'code', 'CODE_LOCKED');
    end if;
    return jsonb_build_object('ok', false, 'code', 'CODE_INVALID');
  end if;
  update public.email_change_requests set consumed_at = now() where id = r.id;
  return jsonb_build_object('ok', true, 'new_email', r.new_email);
end $$;
revoke all on function public.confirm_email_change(uuid, text) from public, anon, authenticated;
grant execute on function public.confirm_email_change(uuid, text) to service_role;
