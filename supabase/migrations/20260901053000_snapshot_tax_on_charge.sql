-- Snapshot fiscal automatico al cobrarse cada componente.
--
-- POR QUE TRIGGER Y NO CODIGO DE APLICACION
--
-- Marcar una reserva como pagada ocurre en al menos cinco lugares distintos
-- (webhooks de Stripe, MercadoPago, Openpay, Conekta y la captura de PayPal),
-- mas los caminos de monedero y check-in. Escribir el snapshot en cada uno
-- significaria tocar los cinco webhooks de pago —que la auditoria de Fase 0
-- concluyo que NO habia que tocar— y dejar el sistema expuesto a que un camino
-- nuevo se olvide de hacerlo, produciendo un cobro sin composicion fiscal.
--
-- Con trigger, el snapshot es atomico con la escritura del pago: no existe un
-- estado intermedio donde la fila este pagada y sin congelar.
--
-- IDEMPOTENTE: solo escribe si el snapshot esta en NULL. Un cobro ya congelado
-- nunca se recalcula, aunque la fila se actualice despues por otro motivo.
--
-- ── NUNCA BLOQUEA EL COBRO ──────────────────────────────────────────────────
-- En Postgres una excepcion dentro de un trigger BEFORE aborta la sentencia
-- completa: no hay aislamiento. Estos triggers viven en las mismas tablas que
-- escriben los cinco webhooks de pago, asi que un fallo aqui —un overflow de
-- numeric(12,2), un caso borde no contemplado— haria fallar el registro del
-- pago sin haber tocado una linea de esos webhooks.
--
-- Por eso el calculo va dentro de un bloque EXCEPTION WHEN OTHERS que devuelve
-- NEW sin tocar. Si el snapshot falla, las columnas quedan en NULL, que es
-- exactamente el estado "cobro anterior a la feature" que los consumidores ya
-- interpretan como 16% implicito. Degrada al comportamiento previo en vez de
-- tumbar el cobro.
--
-- El costo es que un fallo es silencioso para el usuario. Se mitiga con
-- RAISE WARNING (queda en el log de Postgres) y porque el estado es
-- detectable: una fila pagada con tax_treatment NULL es exactamente la
-- consulta de monitoreo que hay que vigilar.
--
-- Contrapartida asumida: un bloque EXCEPTION en plpgsql abre un subtransaction
-- (savepoint) por fila. En estas tablas, con el volumen de un marketplace de
-- tours, es despreciable frente al riesgo de bloquear un pago.
--
-- ── PARIDAD DE FORMULA ──────────────────────────────────────────────────────
-- Esta es la TERCERA copia de la formula (canonica: src/utils/taxBreakdown.ts;
-- Deno: supabase/functions/_shared/taxBreakdown.ts). Un trigger no puede
-- importar TypeScript, asi que no hay forma de evitarlo.
--
-- Debe mantenerse en paridad EXACTA, incluido el orden de las operaciones:
--   exento  = round(bruto * ratio, 2)
--   gravado = bruto - exento
--   base    = round(gravado / 1.16, 2)
--   iva     = gravado - base            <-- por DIFERENCIA, no multiplicando
-- Redondear el IVA por separado descuadra un centavo contra el importe cobrado.

-- ─────────────────────────────────────────────────────────────────────────────
-- Helper compartido por los tres triggers
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.compute_tax_snapshot(
  p_gross        numeric,
  p_treatment    tax_treatment_enum,
  p_exempt_ratio numeric
)
RETURNS TABLE (exempt_amount numeric, taxable_base numeric, vat_amount numeric, tax_rate numeric)
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_ratio   numeric;
  v_exempt  numeric;
  v_gravado numeric;
  v_base    numeric;
BEGIN
  -- El tratamiento manda sobre el ratio, igual que normalizeExemptRatio() en TS.
  v_ratio := CASE p_treatment
               WHEN 'taxable_16' THEN 0
               WHEN 'exempt'     THEN 1
               ELSE COALESCE(p_exempt_ratio, 0)
             END;

  v_exempt  := ROUND(COALESCE(p_gross, 0) * v_ratio, 2);
  v_gravado := ROUND(COALESCE(p_gross, 0), 2) - v_exempt;
  v_base    := ROUND(v_gravado / 1.16, 2);

  exempt_amount := v_exempt;
  taxable_base  := v_base;
  vat_amount    := v_gravado - v_base;  -- por diferencia
  tax_rate      := CASE WHEN v_ratio = 1 THEN 0 ELSE 0.16 END;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.compute_tax_snapshot IS
  'Desglose fiscal para el snapshot al cobro. Paridad obligatoria con calculateTaxBreakdown() en src/utils/taxBreakdown.ts.';

-- ─────────────────────────────────────────────────────────────────────────────
-- bookings — componente TOUR
-- ─────────────────────────────────────────────────────────────────────────────
-- El bruto es el anticipo efectivamente cobrado, no el precio total del tour:
-- el snapshot describe LO COBRADO. El resto del tour se congelara en sus
-- propios cobros (parcialidades, cargo en check-in).

CREATE OR REPLACE FUNCTION public.snapshot_booking_tax()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tour   RECORD;
  v_gross  numeric;
  v_calc   RECORD;
BEGIN
  IF NEW.tax_treatment IS NOT NULL THEN
    RETURN NEW;  -- ya congelado: nunca se recalcula
  END IF;

  IF NEW.paid_at IS NULL AND COALESCE(NEW.payment_status, '') <> 'paid' THEN
    RETURN NEW;  -- aun no se cobra
  END IF;

  BEGIN
    SELECT t.tax_treatment, t.exempt_ratio INTO v_tour
    FROM public.tours t WHERE t.id = NEW.tour_id;

    IF NOT FOUND THEN
      RETURN NEW;
    END IF;

    v_gross := COALESCE(NEW.deposit_amount, NEW.total_price, 0);
    SELECT * INTO v_calc FROM public.compute_tax_snapshot(v_gross, v_tour.tax_treatment, v_tour.exempt_ratio);

    NEW.tax_treatment := v_tour.tax_treatment;
    NEW.exempt_ratio  := v_tour.exempt_ratio;
    NEW.exempt_amount := v_calc.exempt_amount;
    NEW.taxable_base  := v_calc.taxable_base;
    NEW.vat_amount    := v_calc.vat_amount;
    NEW.tax_rate      := v_calc.tax_rate;
  EXCEPTION WHEN OTHERS THEN
    -- El cobro manda. Se deja el snapshot en NULL (= 16% implicito) antes que
    -- hacer fallar el INSERT/UPDATE que registra el pago.
    RAISE WARNING 'snapshot_booking_tax fallo para booking %: % (%)', NEW.id, SQLERRM, SQLSTATE;
    NEW.tax_treatment := NULL; NEW.exempt_ratio := NULL; NEW.exempt_amount := NULL;
    NEW.taxable_base  := NULL; NEW.vat_amount   := NULL; NEW.tax_rate      := NULL;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_snapshot_booking_tax ON public.bookings;
CREATE TRIGGER trg_snapshot_booking_tax
  BEFORE INSERT OR UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.snapshot_booking_tax();

-- ─────────────────────────────────────────────────────────────────────────────
-- booking_supplements — se cobran al 100% tras aprobarse, sin prorrateo
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.snapshot_supplement_tax()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sup   RECORD;
  v_calc  RECORD;
  v_gross numeric;
BEGIN
  IF NEW.tax_treatment IS NOT NULL OR NEW.paid_at IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT ts.tax_treatment, ts.exempt_ratio INTO v_sup
    FROM public.tour_supplements ts WHERE ts.id = NEW.tour_supplement_id;

    IF NOT FOUND THEN
      RETURN NEW;
    END IF;

    v_gross := COALESCE(NEW.unit_price, 0) * COALESCE(NEW.quantity, 1);
    SELECT * INTO v_calc FROM public.compute_tax_snapshot(v_gross, v_sup.tax_treatment, v_sup.exempt_ratio);

    NEW.tax_treatment := v_sup.tax_treatment;
    NEW.exempt_ratio  := v_sup.exempt_ratio;
    NEW.exempt_amount := v_calc.exempt_amount;
    NEW.taxable_base  := v_calc.taxable_base;
    NEW.vat_amount    := v_calc.vat_amount;
    NEW.tax_rate      := v_calc.tax_rate;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'snapshot_supplement_tax fallo para booking_supplement %: % (%)', NEW.id, SQLERRM, SQLSTATE;
    NEW.tax_treatment := NULL; NEW.exempt_ratio := NULL; NEW.exempt_amount := NULL;
    NEW.taxable_base  := NULL; NEW.vat_amount   := NULL; NEW.tax_rate      := NULL;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_snapshot_supplement_tax ON public.booking_supplements;
CREATE TRIGGER trg_snapshot_supplement_tax
  BEFORE INSERT OR UPDATE ON public.booking_supplements
  FOR EACH ROW EXECUTE FUNCTION public.snapshot_supplement_tax();

-- ─────────────────────────────────────────────────────────────────────────────
-- booking_optional_services — se cobran al 100% en su momento
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.snapshot_optional_service_tax()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_svc   RECORD;
  v_calc  RECORD;
BEGIN
  IF NEW.tax_treatment IS NOT NULL OR NEW.paid_at IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT tos.tax_treatment, tos.exempt_ratio INTO v_svc
    FROM public.tour_optional_services tos WHERE tos.id = NEW.tour_optional_service_id;

    IF NOT FOUND THEN
      -- Pickup e idioma no tienen fila en tour_optional_services: son opcionales
      -- del sistema, gravados al 16% como hasta ahora. Confirmado en datos:
      -- hay filas con tour_optional_service_id NULL.
      SELECT * INTO v_calc FROM public.compute_tax_snapshot(COALESCE(NEW.subtotal, 0), 'taxable_16', 0);
      NEW.tax_treatment := 'taxable_16';
      NEW.exempt_ratio  := 0;
    ELSE
      SELECT * INTO v_calc FROM public.compute_tax_snapshot(COALESCE(NEW.subtotal, 0), v_svc.tax_treatment, v_svc.exempt_ratio);
      NEW.tax_treatment := v_svc.tax_treatment;
      NEW.exempt_ratio  := v_svc.exempt_ratio;
    END IF;

    NEW.exempt_amount := v_calc.exempt_amount;
    NEW.taxable_base  := v_calc.taxable_base;
    NEW.vat_amount    := v_calc.vat_amount;
    NEW.tax_rate      := v_calc.tax_rate;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'snapshot_optional_service_tax fallo para booking_optional_service %: % (%)', NEW.id, SQLERRM, SQLSTATE;
    NEW.tax_treatment := NULL; NEW.exempt_ratio := NULL; NEW.exempt_amount := NULL;
    NEW.taxable_base  := NULL; NEW.vat_amount   := NULL; NEW.tax_rate      := NULL;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_snapshot_optional_service_tax ON public.booking_optional_services;
CREATE TRIGGER trg_snapshot_optional_service_tax
  BEFORE INSERT OR UPDATE ON public.booking_optional_services
  FOR EACH ROW EXECUTE FUNCTION public.snapshot_optional_service_tax();
