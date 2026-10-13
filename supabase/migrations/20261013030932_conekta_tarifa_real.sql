-- Tarifa real de Conekta: 3.5% + $2.50 MXN + IVA (confirmada por Axel el
-- 12-oct-2026 y cuadrada contra un cobro real: orden ord_31u32BWu46zQSZq1x,
-- $500.00, Conekta cobro fee=2320 centavos = (500 x 3.5% + 2.50) x 1.16 = 23.20).
--
-- Se guarda CON EL IVA DENTRO (4.06% + $2.90) porque asi la leen los dos
-- consumidores:
--   - create_accounting_entry_for_booking trata pct x monto + fijo como el TOTAL
--     y lo parte /1.16 en base e IVA;
--   - conekta-webhook guarda ese mismo total en payment_transactions.processor_fee.
-- Guardar 3.5 / 2.50 (sin IVA) dejaria la estimacion 16% corta en los dos lados.
-- Mismo criterio que la etiqueta "IVA incluido" de AdminSettings.
--
-- El valor anterior (3.29% + $2.50) estimo 18.95 para ese cobro de 23.20.
begin;

update public.platform_settings
   set conekta_commission_pct = 4.06,
       conekta_commission_fixed = 2.90;

alter table public.platform_settings alter column conekta_commission_pct set default 4.06;
alter table public.platform_settings alter column conekta_commission_fixed set default 2.90;

commit;
