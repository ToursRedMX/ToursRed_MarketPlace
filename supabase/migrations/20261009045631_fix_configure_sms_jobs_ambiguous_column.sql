-- configure_sms_jobs declaraba la variable `job`, igual que el nombre de la tabla
-- cron.job. Dentro de `select 1 from cron.job where jobname=job`, Postgres no
-- puede decidir si `job` es la variable PL/pgSQL o la fila completa de cron.job
-- (su alias implicito es el propio nombre de la tabla), y siempre fallaba con:
--
--   ERROR: 42702: column reference "job" is ambiguous
--
-- Nunca se habia ejecutado hasta hoy: la funcion existia desde 20261008061340
-- pero nadie la habia invocado para instalar los cron jobs de SMS.
--
-- Fix: renombrar la variable a v_job. Misma logica, sin cambio de firma.
-- Rollback: volver a aplicar la version de 20261008061340_sms_booking_notifications.sql
-- (reintroduce el bug).

create or replace function public.configure_sms_jobs(p_base_url text, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_job text; endpoint text; schedule text; command text;
begin
 if p_base_url is null or p_base_url !~ '^https://[a-z0-9]{20}\.supabase\.co$' then raise exception 'URL de proyecto invalida'; end if;
 if not exists(select 1 from pg_extension where extname='pg_cron') then raise exception 'pg_cron no instalado'; end if;
 foreach v_job in array array['sms-outbox','sms-scheduler','sms-health','sms-retention'] loop
  if exists(select 1 from cron.job where jobname=v_job) then perform cron.unschedule(v_job); end if;
  if p_enabled then
   if v_job='sms-retention' then perform cron.schedule(v_job,'25 4 * * *','select public.purge_sms_private_data()');
   else
    endpoint:=case v_job when 'sms-outbox' then 'process-notification-outbox' when 'sms-scheduler' then 'queue-booking-reminders' else 'monitor-sms-health' end;
    schedule:=case v_job when 'sms-outbox' then '* * * * *' when 'sms-scheduler' then '*/15 * * * *' else '5 * * * *' end;
    command:=format('select net.http_post(url := %L, headers := jsonb_build_object(''Content-Type'',''application/json'',''apikey'',(select decrypted_secret from vault.decrypted_secrets where name=''service_role_key'')), body := ''{}''::jsonb)',p_base_url||'/functions/v1/'||endpoint);
    perform cron.schedule(v_job,schedule,command);
   end if;
  end if;
 end loop;
end $$;

revoke all on function public.configure_sms_jobs(text, boolean) from public, anon, authenticated;
grant execute on function public.configure_sms_jobs(text, boolean) to service_role;
