-- messaging_private.booking_sms_snapshot() necesita destinations.time_zone para
-- calcular departure_at (confirmacion/recordatorio por SMS). Las 7 destinations
-- existentes se crearon antes de que el formulario de AdminDestinations pidiera
-- esta columna y quedaron en NULL, bloqueando el recordatorio de un dia antes
-- para CUALQUIER tour (no solo los de prueba). Zona asignada por el municipio
-- real de cada destino, no por defecto:
-- - Centro (America/Mexico_City): Dzibilnocac, Hochob, Toh Coh (ruta Chenes,
--   Campeche), Teotihuacan (Edo. Mex.), Tlaxcala.
-- - Pacifico (America/Mazatlan): San Blas e Islas Marias (ambas en el
--   municipio de San Blas, Nayarit — excepcion de Bahia de Banderas no aplica).
begin;

update public.destinations
set time_zone = 'America/Mexico_City'
where time_zone is null
  and name in ('DZIBILNOCAC', 'Hochob', 'TOH COH', 'Teotihuacan', 'Tlaxcala');

update public.destinations
set time_zone = 'America/Mazatlan'
where time_zone is null
  and name in ('San Blas', 'Islas Marias');

-- Resguardo para que un destino nuevo insertado fuera del formulario (seed,
-- script, otro admin) no vuelva a quedar sin zona horaria en silencio.
alter table public.destinations alter column time_zone set default 'America/Mexico_City';
alter table public.destinations alter column time_zone set not null;

commit;
