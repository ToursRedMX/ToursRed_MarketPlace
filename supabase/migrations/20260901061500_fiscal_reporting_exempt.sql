-- Reportes fiscales: separar operaciones gravadas de exentas.
--
-- cfdi_invoices ya guarda subtotal (base gravable), iva_amount y total, y ya
-- distingue el origen por sus FK (booking_id, booking_supplement_id,
-- booking_optional_service_id). Lo unico que faltaba para poder reportar
-- gravado vs exento era el importe exento.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Importe exento en el comprobante
-- ─────────────────────────────────────────────────────────────────────────────
-- DEFAULT 0 aqui SI es correcto, a diferencia del snapshot de bookings: un CFDI
-- historico realmente amparo cero pesos exentos, porque la exencion no existia
-- en el sistema. Es una afirmacion verdadera, no un relleno.
--
-- Invariante: subtotal + iva_amount + exempt_amount = total.

ALTER TABLE public.cfdi_invoices
  ADD COLUMN IF NOT EXISTS exempt_amount numeric(12,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.cfdi_invoices.exempt_amount IS
  'Importe amparado como exento de IVA (Art. 15 fr. XIII LIVA). subtotal + iva_amount + exempt_amount = total. 0 en CFDI anteriores a la feature, que es el valor real.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Vista de resumen fiscal por origen
-- ─────────────────────────────────────────────────────────────────────────────
-- No reemplaza ningun reporte existente: es aditiva. Los reportes actuales
-- siguen leyendo cfdi_invoices como hasta ahora y no cambian de formato.
--
-- El origen se deduce de las FK, que ya existian. `manual` y `otro` agrupan los
-- comprobantes de producto propio de ToursRed (comisiones, membresias,
-- destacados), que siempre van gravados al 16% y por eso conviene poder
-- separarlos de lo que se vende por cuenta de la agencia.

CREATE OR REPLACE VIEW public.fiscal_summary_by_origin AS
SELECT
  date_trunc('month', COALESCE(ci.stamped_at, ci.created_at))::date AS periodo,
  CASE
    WHEN ci.booking_supplement_id       IS NOT NULL THEN 'suplemento'
    WHEN ci.booking_optional_service_id IS NOT NULL THEN 'servicio_opcional'
    WHEN ci.booking_id                  IS NOT NULL THEN 'tour'
    ELSE 'otro'
  END AS origen,
  ci.cfdi_type,
  ci.invoice_type,
  count(*)                                   AS comprobantes,
  -- Gravado
  COALESCE(sum(ci.subtotal), 0)              AS base_iva_16,
  COALESCE(sum(ci.iva_amount), 0)            AS iva_trasladado,
  COALESCE(sum(ci.subtotal + ci.iva_amount), 0) AS total_gravado,
  -- Exento
  COALESCE(sum(ci.exempt_amount), 0)         AS total_exento,
  -- Control
  COALESCE(sum(ci.total), 0)                 AS total_comprobado,
  COALESCE(sum(ci.subtotal + ci.iva_amount + ci.exempt_amount), 0) AS total_reconstruido
FROM public.cfdi_invoices ci
WHERE ci.status = 'stamped'
GROUP BY 1, 2, 3, 4;

COMMENT ON VIEW public.fiscal_summary_by_origin IS
  'Resumen fiscal mensual: gravado vs exento, base IVA 16% e IVA trasladado, desglosado por origen (tour / suplemento / servicio_opcional / otro). Aditiva: no altera los reportes existentes. Si total_comprobado != total_reconstruido hay un CFDI cuyos importes no cuadran.';

-- La vista hereda el RLS de cfdi_invoices al declararse con security_invoker,
-- asi que una agencia solo agrega sus propios comprobantes. Sin esto, la vista
-- correria con los permisos del creador y expondria los totales de todas.
ALTER VIEW public.fiscal_summary_by_origin SET (security_invoker = true);
