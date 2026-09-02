-- Tratamiento fiscal mixto de IVA (Art. 15 fr. XIII LIVA)
--
-- Permite marcar un tour, un suplemento o un servicio opcional como gravado
-- al 16% (default), exento, o mixto. Las tres entidades son fiscalmente
-- INDEPENDIENTES: un tour gravado puede tener un opcional exento ("Entrada a
-- Six Flags") y ninguno hereda del otro.
--
-- Por que numeric(9,8) y no (5,4): con cuatro decimales, 999/1499 se almacena
-- como 0.6664 y un anticipo del 40% da 399.57 en vez de 399.60 —tres centavos
-- de desviacion, medidos, no estimados—. La suma fiscal cuadra igual con ambas
-- precisiones, pero la frontera entre exento y gravado se corre. Ocho decimales
-- reproducen el importe exacto y no tienen contrapartida.
--
-- Por que proporcion y no pesos: `tours` tiene CINCO columnas de precio
-- (price, precio_adulto, precio_adulto_mayor, precio_nino, precio_infante,
-- precio_mascota). Un importe fijo en pesos para "parte exenta" no escala
-- entre esas tarifas; una proporcion si. La UI captura pesos sobre
-- precio_adulto y deriva el ratio.
--
-- Retrocompatibilidad: los defaults (taxable_16 / 0) reproducen exactamente el
-- comportamiento actual, asi que ninguna fila existente cambia de conducta.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Enum
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tax_treatment_enum') THEN
    CREATE TYPE tax_treatment_enum AS ENUM ('taxable_16', 'exempt', 'mixed');
  END IF;
END$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Configuracion fiscal en las tres entidades vendibles
-- ─────────────────────────────────────────────────────────────────────────────
-- El CHECK unico cubre las tres combinaciones validas. Es la ultima linea de
-- defensa contra un cliente que mande exempt_ratio incoherente con
-- tax_treatment saltandose el frontend: la BD lo rechaza.

ALTER TABLE public.tours
  ADD COLUMN IF NOT EXISTS tax_treatment tax_treatment_enum NOT NULL DEFAULT 'taxable_16',
  ADD COLUMN IF NOT EXISTS exempt_ratio  numeric(9,8)       NOT NULL DEFAULT 0;

ALTER TABLE public.tour_supplements
  ADD COLUMN IF NOT EXISTS tax_treatment tax_treatment_enum NOT NULL DEFAULT 'taxable_16',
  ADD COLUMN IF NOT EXISTS exempt_ratio  numeric(9,8)       NOT NULL DEFAULT 0;

ALTER TABLE public.tour_optional_services
  ADD COLUMN IF NOT EXISTS tax_treatment tax_treatment_enum NOT NULL DEFAULT 'taxable_16',
  ADD COLUMN IF NOT EXISTS exempt_ratio  numeric(9,8)       NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tours_tax_treatment_ratio_check') THEN
    ALTER TABLE public.tours ADD CONSTRAINT tours_tax_treatment_ratio_check CHECK (
      (tax_treatment = 'taxable_16' AND exempt_ratio = 0)
      OR (tax_treatment = 'exempt'     AND exempt_ratio = 1)
      OR (tax_treatment = 'mixed'      AND exempt_ratio > 0 AND exempt_ratio < 1)
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tour_supplements_tax_treatment_ratio_check') THEN
    ALTER TABLE public.tour_supplements ADD CONSTRAINT tour_supplements_tax_treatment_ratio_check CHECK (
      (tax_treatment = 'taxable_16' AND exempt_ratio = 0)
      OR (tax_treatment = 'exempt'     AND exempt_ratio = 1)
      OR (tax_treatment = 'mixed'      AND exempt_ratio > 0 AND exempt_ratio < 1)
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tour_optional_services_tax_treatment_ratio_check') THEN
    ALTER TABLE public.tour_optional_services ADD CONSTRAINT tour_optional_services_tax_treatment_ratio_check CHECK (
      (tax_treatment = 'taxable_16' AND exempt_ratio = 0)
      OR (tax_treatment = 'exempt'     AND exempt_ratio = 1)
      OR (tax_treatment = 'mixed'      AND exempt_ratio > 0 AND exempt_ratio < 1)
    );
  END IF;
END$$;

COMMENT ON COLUMN public.tours.exempt_ratio IS
  'Proporcion exenta de IVA (0..1) aplicada a las CINCO tarifas y al anticipo. Derivada en la UI como importe_exento / precio_adulto.';
COMMENT ON COLUMN public.tour_supplements.exempt_ratio IS
  'Proporcion exenta de IVA (0..1) sobre price. Independiente del tour padre.';
COMMENT ON COLUMN public.tour_optional_services.exempt_ratio IS
  'Proporcion exenta de IVA (0..1) sobre price_per_person. Independiente del tour padre.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Snapshot fiscal al momento del cobro
-- ─────────────────────────────────────────────────────────────────────────────
-- Congela la composicion fiscal del componente cuando se cobra, para que
-- cambiar el tratamiento del tour/suplemento/opcional despues NUNCA altere un
-- cobro ya hecho ni un CFDI ya emitido.
--
-- NULLABLE Y SIN DEFAULT a proposito. NULL significa "cobro anterior a esta
-- feature", no "cero pesos de IVA". Ponerles DEFAULT 0 afirmaria que las
-- reservas historicas no causaron IVA, que es falso: causaron 16% sobre el
-- total. Los consumidores deben tratar NULL como "16% implicito sobre el
-- bruto", que es exactamente como se comporto el sistema hasta hoy.
--
-- tax_rate se guarda por fila —y no como constante— para que un cambio futuro
-- de la tasa legal no reinterprete cobros viejos.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS tax_treatment  tax_treatment_enum,
  ADD COLUMN IF NOT EXISTS exempt_ratio   numeric(9,8),
  ADD COLUMN IF NOT EXISTS taxable_base   numeric(12,2),
  ADD COLUMN IF NOT EXISTS vat_amount     numeric(12,2),
  ADD COLUMN IF NOT EXISTS exempt_amount  numeric(12,2),
  ADD COLUMN IF NOT EXISTS tax_rate       numeric(5,4);

ALTER TABLE public.booking_supplements
  ADD COLUMN IF NOT EXISTS tax_treatment  tax_treatment_enum,
  ADD COLUMN IF NOT EXISTS exempt_ratio   numeric(9,8),
  ADD COLUMN IF NOT EXISTS taxable_base   numeric(12,2),
  ADD COLUMN IF NOT EXISTS vat_amount     numeric(12,2),
  ADD COLUMN IF NOT EXISTS exempt_amount  numeric(12,2),
  ADD COLUMN IF NOT EXISTS tax_rate       numeric(5,4);

ALTER TABLE public.booking_optional_services
  ADD COLUMN IF NOT EXISTS tax_treatment  tax_treatment_enum,
  ADD COLUMN IF NOT EXISTS exempt_ratio   numeric(9,8),
  ADD COLUMN IF NOT EXISTS taxable_base   numeric(12,2),
  ADD COLUMN IF NOT EXISTS vat_amount     numeric(12,2),
  ADD COLUMN IF NOT EXISTS exempt_amount  numeric(12,2),
  ADD COLUMN IF NOT EXISTS tax_rate       numeric(5,4);

COMMENT ON COLUMN public.bookings.exempt_amount IS
  'Snapshot fiscal del COMPONENTE TOUR al cobrarse. NULL = cobro anterior a la feature (16% implicito). No incluye suplementos ni opcionales, que llevan su propio snapshot.';
COMMENT ON COLUMN public.booking_supplements.exempt_amount IS
  'Snapshot fiscal del suplemento al cobrarse (tras aprobarse), sobre el 100% de lo cobrado. NULL = cobro anterior a la feature.';
COMMENT ON COLUMN public.booking_optional_services.exempt_amount IS
  'Snapshot fiscal del opcional al cobrarse, sobre el 100% de lo cobrado. NULL = cobro anterior a la feature.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. RLS
-- ─────────────────────────────────────────────────────────────────────────────
-- Sin politicas nuevas a proposito. RLS en Postgres es a nivel de FILA, no de
-- columna: las politicas existentes ("Agencies can update own tours", "Agency
-- can update supplements/optional services for own tours", todas con USING y
-- WITH CHECK sobre agencies.user_id = auth.uid()) ya cubren estas columnas.
-- Verificado con una agencia distinta a la dueña en las tres tablas.
