-- certify_sms_runtime quedo con un UPDATE sin WHERE. Este proyecto exige WHERE
-- en todo UPDATE/DELETE (guardia de Postgres), asi que la funcion fallaba
-- siempre con "UPDATE requires a WHERE clause" (SQLSTATE 21000) sin importar
-- que los secretos de certificacion estuvieran bien. runtime_capabilities es
-- un singleton (singleton boolean primary key default true), asi que "where
-- singleton" es exacto: actualiza la unica fila que puede existir.
--
-- Encontrado al disparar monitor-sms-health manualmente para certificar el
-- motor SMS: devolvia 503 "monitor_no_disponible" sin rastro hasta agregar un
-- console.error temporal a la funcion.

create or replace function public.certify_sms_runtime(p_processor boolean, p_otp boolean)
returns void
language sql
security definer
set search_path = ''
as $$
  update messaging_private.runtime_capabilities
  set processor_ready = p_processor, otp_enforcement_ready = p_otp
  where singleton;
$$;

revoke all on function public.certify_sms_runtime(boolean, boolean) from public, anon, authenticated;
grant execute on function public.certify_sms_runtime(boolean, boolean) to service_role;

-- Mismo defecto, mismo archivo: el trigger que marca sms_enabled_since al
-- prender sms_habilitado desde Ajustes tambien haria un UPDATE sin WHERE y
-- tronaria la transaccion de update_sms_settings en cuanto alguien active el
-- switch. Se encontro al revisar el resto de la migracion por el mismo
-- patron, antes de que se disparara en vivo.
create or replace function messaging_private.track_sms_activation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.sms_habilitado and not old.sms_habilitado then
    update messaging_private.runtime_capabilities set sms_enabled_since = now() where singleton;
  end if;
  return new;
end
$$;
