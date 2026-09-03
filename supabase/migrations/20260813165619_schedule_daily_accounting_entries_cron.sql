/*
# Cierre contable automático diario

## Propósito
Programar un job automático con pg_cron que ejecute diariamente la función
`generate_accounting_entries_batch()` para generar asientos contables pendientes
de forma automática, sin requerir intervención manual del contador.

## Cambios
- Programa un cron job llamado `generate-accounting-entries-daily` que corre
  todos los días a las 4:00 AM UTC (equivalente a 10:00 PM hora de México CST)
- Ejecuta `SELECT generate_accounting_entries_batch(NULL, NULL)` con los
  parámetros default (rango completo)
- El job queda activo automáticamente

## Seguridad
- La función generate_accounting_entries_batch es SECURITY DEFINER
- El cron job ejecuta con privilegios del rol postgres
*/

SELECT cron.schedule(
  'generate-accounting-entries-daily',
  '0 4 * * *',
  $$SELECT generate_accounting_entries_batch(NULL, NULL);$$
);
