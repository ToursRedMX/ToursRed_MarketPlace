-- Tarifa real de Stripe: 3.6% + $3.00 MXN + IVA (tarjeta nacional).
--
-- stripe.com/mx/pricing, consultada el 14-oct-2026: "3.6% + MXN3.00" y "Todas las
-- comisiones excluyen el IVA". Se guardaba 3.1034% + $2.59, que es 3.6% + $3 DIVIDIDO
-- /1.16: trataba la tarifa como si ya trajera el IVA, y la estimacion salia ~26% corta.
--
-- Cuadrado contra los cobros reales (payment_transactions, processor_fee que Stripe
-- reporta en balance_transaction): 10 de 12 cobros de prueba dan EXACTO
-- base = 4.100% x monto + $3.00 e IVA = 16% de esa base. El 4.1% es 3.6% + 0.5% "por
-- tarjetas internacionales" (las tarjetas de prueba de Stripe son de EE.UU.). Ejemplo:
-- $1,338.75 -> Stripe cobro 67.15 = (1338.75 x 4.1% + 3) x 1.16. Con la tarifa nacional
-- de aqui mas el recargo internacional con IVA (0.58%) da los mismos 67.15.
--
-- Se guarda CON EL IVA DENTRO (4.176% + $3.48), igual que Conekta en 20261013030932:
-- create_accounting_entry_for_booking trata pct x monto + fijo como el TOTAL y lo parte
-- /1.16. Solo se usa como RESPALDO, cuando el cobro llego sin comision real; el
-- stripe-webhook guarda la de balance_transaction.
--
-- Rollback: los mismos dos updates y defaults con 3.1034 / 2.59.
begin;

update public.platform_settings
   set stripe_commission_pct = 4.176,
       stripe_commission_fixed = 3.48;

alter table public.platform_settings alter column stripe_commission_pct set default 4.176;
alter table public.platform_settings alter column stripe_commission_fixed set default 3.48;

commit;
