-- ============================================================================
-- Paridad SQL <-> TypeScript de compute_tax_snapshot()
-- ============================================================================
--
-- compute_tax_snapshot() es la TERCERA copia de la formula de IVA (canonica:
-- src/utils/taxBreakdown.ts; Deno: supabase/functions/_shared/taxBreakdown.ts).
-- Un trigger no puede importar TypeScript, asi que la traduccion a plpgsql se
-- hizo A MANO. Este archivo existe para no confiar en que esa traduccion
-- preservo la logica.
--
-- Los valores esperados NO se recalculan aqui: estan hardcodeados con la
-- salida REAL de scripts/test-tax-breakdown.mjs. Si la version SQL discrepa,
-- discrepa contra el numero que produce la canonica, no contra otra
-- interpretacion de la misma formula.
--
-- Precedente que justifica esto: numeric(5,4) parecia correcto y desviaba tres
-- centavos en el anticipo del 40%. Un redondeo silencioso no se ve leyendo
-- codigo; se ve comparando numeros.
--
-- USO (tras aplicar 20260901041500 y 20260901053000):
--   psql "$DATABASE_URL" -f scripts/test-tax-snapshot-sql.sql
-- o pegarlo en el SQL editor de Supabase. Devuelve una fila por caso con
-- resultado PASS/FAIL y una fila final de resumen.
-- ============================================================================

WITH casos(n, descripcion, bruto, tratamiento, ratio,
           esp_exento, esp_base, esp_iva, esp_tasa) AS (
  VALUES
  -- ── 1. Tour 100% gravado $1,000, anticipo 40% ────────────────────────────
  (1,  'gravado 1000 @40% = 400',
       400.00,   'taxable_16'::tax_treatment_enum, 0::numeric,
       0.00,     344.83,  55.17,  0.16),

  -- ── 2. Tour 100% exento $1,000, anticipo 40% ─────────────────────────────
  (2,  'exento 1000 @40% = 400',
       400.00,   'exempt',    1,
       400.00,   0.00,    0.00,   0.00),

  -- ── 3. Tour mixto 1499 (exento 999), anticipo 40% ────────────────────────
  --    ratio = 999/1499 a 8 decimales = 0.66644430
  (3,  'mixto 1499 @40% = 599.60',
       599.60,   'mixed',     0.66644430,
       399.60,   172.41,  27.59,  0.16),

  -- ── 4. Mismo tour, anticipo 30% ──────────────────────────────────────────
  (4,  'mixto 1499 @30% = 449.70',
       449.70,   'mixed',     0.66644430,
       299.70,   129.31,  20.69,  0.16),

  -- ── 11. Las 5 tarifas con el mismo ratio ─────────────────────────────────
  (11, 'tarifa precio_adulto 1499',
       1499.00,  'mixed',     0.66644430,
       999.00,   431.03,  68.97,  0.16),
  (12, 'tarifa precio_adulto_mayor 1299',
       1299.00,  'mixed',     0.66644430,
       865.71,   373.53,  59.76,  0.16),
  (13, 'tarifa precio_nino 899',
       899.00,   'mixed',     0.66644430,
       599.13,   258.51,  41.36,  0.16),
  (14, 'tarifa precio_infante 0',
       0.00,     'mixed',     0.66644430,
       0.00,     0.00,    0.00,   0.16),
  (15, 'tarifa precio_mascota 350',
       350.00,   'mixed',     0.66644430,
       233.26,   100.64,  16.10,  0.16),

  -- ── 12. Tour gravado + opcional exento (Six Flags), sin contaminarse ─────
  (16, 'Six Flags: tour gravado 2000',
       2000.00,  'taxable_16', 0,
       0.00,     1724.14, 275.86, 0.16),
  (17, 'Six Flags: opcional exento 850',
       850.00,   'exempt',     1,
       850.00,   0.00,    0.00,   0.00),

  -- ── 13. Tour mixto 30% + suplemento mixto 70%, sin promediarse ───────────
  (18, 'tour mixto 30% sobre 1000',
       1000.00,  'mixed',      0.30,
       300.00,   603.45,  96.55,  0.16),
  (19, 'suplemento mixto 70% sobre 1000',
       1000.00,  'mixed',      0.70,
       700.00,   258.62,  41.38,  0.16),

  -- ── 7/8. Comision de ToursRed: siempre 16%, nunca hereda ────────────────
  (20, 'comision 116 (siempre gravada)',
       116.00,   'taxable_16', 0,
       0.00,     100.00,  16.00,  0.16),

  -- ── El tratamiento manda sobre el ratio (normalizeExemptRatio) ──────────
  (21, 'taxable_16 ignora un ratio incoherente',
       400.00,   'taxable_16', 0.5,
       0.00,     344.83,  55.17,  0.16),
  (22, 'exempt ignora un ratio incoherente',
       400.00,   'exempt',     0.3,
       400.00,   0.00,    0.00,   0.00),

  -- ── 5. Centavos que fuerzan redondeo ────────────────────────────────────
  (23, 'centavos: 333.33 mixto 1/3',
       333.33,   'mixed',      0.33333333,
       111.11,   191.57,  30.65,  0.16),
  (24, 'centavos: 0.01 mixto 50%',
       0.01,     'mixed',      0.50,
       0.01,     0.00,    0.00,   0.16)
),
resultados AS (
  SELECT
    c.n, c.descripcion, c.bruto,
    r.exempt_amount, r.taxable_base, r.vat_amount, r.tax_rate,
    c.esp_exento, c.esp_base, c.esp_iva, c.esp_tasa,
    -- Cuadre: exento + base + iva debe dar EXACTAMENTE el bruto cobrado.
    (r.exempt_amount + r.taxable_base + r.vat_amount) AS suma,
    (r.exempt_amount = c.esp_exento
     AND r.taxable_base = c.esp_base
     AND r.vat_amount  = c.esp_iva
     AND r.tax_rate    = c.esp_tasa
     AND (r.exempt_amount + r.taxable_base + r.vat_amount) = ROUND(c.bruto, 2)
    ) AS ok
  FROM casos c
  CROSS JOIN LATERAL public.compute_tax_snapshot(c.bruto, c.tratamiento, c.ratio) r
)
SELECT
  n,
  CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS resultado,
  descripcion,
  bruto,
  exempt_amount AS exento, esp_exento AS exento_esperado,
  taxable_base  AS base,   esp_base   AS base_esperada,
  vat_amount    AS iva,    esp_iva    AS iva_esperado,
  tax_rate      AS tasa,   esp_tasa   AS tasa_esperada,
  suma,
  CASE WHEN suma = ROUND(bruto, 2) THEN 'cuadra' ELSE 'DESCUADRE' END AS cuadre
FROM resultados
ORDER BY n;

-- Resumen. Si esta consulta devuelve algo distinto de 0 fallos, la traduccion
-- manual a plpgsql NO preservo la logica de la canonica en TypeScript y el
-- snapshot escribiria numeros distintos a los que produce el CFDI.
WITH casos(n, bruto, tratamiento, ratio, esp_exento, esp_base, esp_iva, esp_tasa) AS (
  VALUES
  (1,400.00,'taxable_16'::tax_treatment_enum,0::numeric,0.00,344.83,55.17,0.16),
  (2,400.00,'exempt',1,400.00,0.00,0.00,0.00),
  (3,599.60,'mixed',0.66644430,399.60,172.41,27.59,0.16),
  (4,449.70,'mixed',0.66644430,299.70,129.31,20.69,0.16),
  (11,1499.00,'mixed',0.66644430,999.00,431.03,68.97,0.16),
  (12,1299.00,'mixed',0.66644430,865.71,373.53,59.76,0.16),
  (13,899.00,'mixed',0.66644430,599.13,258.51,41.36,0.16),
  (14,0.00,'mixed',0.66644430,0.00,0.00,0.00,0.16),
  (15,350.00,'mixed',0.66644430,233.26,100.64,16.10,0.16),
  (16,2000.00,'taxable_16',0,0.00,1724.14,275.86,0.16),
  (17,850.00,'exempt',1,850.00,0.00,0.00,0.00),
  (18,1000.00,'mixed',0.30,300.00,603.45,96.55,0.16),
  (19,1000.00,'mixed',0.70,700.00,258.62,41.38,0.16),
  (20,116.00,'taxable_16',0,0.00,100.00,16.00,0.16),
  (21,400.00,'taxable_16',0.5,0.00,344.83,55.17,0.16),
  (22,400.00,'exempt',0.3,400.00,0.00,0.00,0.00),
  (23,333.33,'mixed',0.33333333,111.11,191.57,30.65,0.16),
  (24,0.01,'mixed',0.50,0.01,0.00,0.00,0.16)
)
SELECT
  count(*) AS casos_totales,
  count(*) FILTER (WHERE NOT (
    r.exempt_amount = c.esp_exento AND r.taxable_base = c.esp_base
    AND r.vat_amount = c.esp_iva AND r.tax_rate = c.esp_tasa
    AND (r.exempt_amount + r.taxable_base + r.vat_amount) = ROUND(c.bruto, 2)
  )) AS fallos,
  CASE WHEN count(*) FILTER (WHERE NOT (
    r.exempt_amount = c.esp_exento AND r.taxable_base = c.esp_base
    AND r.vat_amount = c.esp_iva AND r.tax_rate = c.esp_tasa
    AND (r.exempt_amount + r.taxable_base + r.vat_amount) = ROUND(c.bruto, 2)
  )) = 0
  THEN 'PARIDAD SQL<->TS CONFIRMADA'
  ELSE 'DIVERGENCIA — la traduccion a plpgsql NO preserva la canonica'
  END AS veredicto
FROM casos c
CROSS JOIN LATERAL public.compute_tax_snapshot(c.bruto, c.tratamiento, c.ratio) r;
