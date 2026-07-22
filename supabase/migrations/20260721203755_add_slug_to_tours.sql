/*
# Añadir columna slug a tabla tours para URLs SEO-friendly

## Descripción
Migra las URLs públicas de tours de UUID a slugs legibles para SEO.
Ej: "Tour a Islas Marías 3 días" → /tours/tour-a-islas-marias-3-dias

## Cambios
1. Nueva columna `slug` (text) en tabla `tours` — nullable inicialmente
2. Nueva función `generate_tour_slug(p_name text)` — normaliza nombre a slug
   (minúsculas, sin acentos, espacios→guiones, sin caracteres especiales)
   y resuelve colisiones con sufijo numérico (-2, -3, etc.)
3. Backfill: genera slug para todos los tours existentes (4 tours)
4. Unique constraint en `slug`
5. Columna `slug` → NOT NULL
6. Trigger `set_tour_slug_on_insert` — genera slug automáticamente al
   crear un tour nuevo. NO se ejecuta en UPDATE (preserva URLs indexadas;
   el admin debe cambiar el slug manualmente si lo desea)

## Seguridad
- Sin cambios en RLS (la columna slug es pública, legible por cualquier
  consulta existente que haga SELECT * sobre tours)
- El trigger es SECURITY INVOKER (default), corre con los permisos del
  usuario que hace INSERT

## Notas
- La PK interna sigue siendo `id` (uuid). El slug es solo para URL pública.
- Las foreign keys y queries internas no cambian.
*/

-- ── 1. Añadir columna slug ──────────────────────────────────────
ALTER TABLE tours ADD COLUMN IF NOT EXISTS slug text;

-- ── 2. Función generadora de slugs ──────────────────────────────
-- Normaliza un nombre a slug SEO-friendly y resuelve colisiones.
CREATE OR REPLACE FUNCTION public.generate_tour_slug(p_name text)
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  base_slug text;
  candidate text;
  suffix int := 0;
BEGIN
  base_slug := lower(p_name);
  -- Quitar acentos y ñ
  base_slug := translate(base_slug, 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiounaeioun');
  -- Espacios a guiones
  base_slug := regexp_replace(base_slug, '\s+', '-', 'g');
  -- Eliminar todo lo que no sea alfanumérico o guion
  base_slug := regexp_replace(base_slug, '[^a-z0-9-]', '', 'g');
  -- Colapsar guiones múltiples
  base_slug := regexp_replace(base_slug, '-+', '-', 'g');
  -- Trim guiones en extremos
  base_slug := trim(both '-' from base_slug);

  IF base_slug = '' OR base_slug IS NULL THEN
    base_slug := 'tour';
  END IF;

  candidate := base_slug;
  WHILE EXISTS (SELECT 1 FROM public.tours WHERE tours.slug = candidate) LOOP
    suffix := suffix + 1;
    candidate := base_slug || '-' || suffix::text;
  END LOOP;

  RETURN candidate;
END;
$$;

-- ── 3. Backfill: generar slug para tours existentes ─────────────
-- Se hace fila por fila para que cada llamada a generate_tour_slug
-- vea los slugs ya asignados y resuelva colisiones correctamente.
DO $$
DECLARE
  r RECORD;
  new_slug text;
BEGIN
  FOR r IN SELECT id, name FROM public.tours WHERE slug IS NULL ORDER BY created_at LOOP
    new_slug := public.generate_tour_slug(r.name);
    UPDATE public.tours SET slug = new_slug WHERE id = r.id;
  END LOOP;
END $$;

-- ── 4. Unique constraint ────────────────────────────────────────
-- Se crea después del backfill para evitar conflictos.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tours_slug_key' AND conrelid = 'public.tours'::regclass
  ) THEN
    ALTER TABLE public.tours ADD CONSTRAINT tours_slug_key UNIQUE (slug);
  END IF;
END $$;

-- ── 5. NOT NULL ─────────────────────────────────────────────────
-- Solo después de que todos los tours tienen slug asignado.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'tours' AND column_name = 'slug' AND is_nullable = 'YES') THEN
    ALTER TABLE public.tours ALTER COLUMN slug SET NOT NULL;
  END IF;
END $$;

-- ── 6. Trigger: generar slug al INSERT ──────────────────────────
-- Solo en INSERT, nunca en UPDATE de name (preserva URLs indexadas).
DROP FUNCTION IF EXISTS public.set_tour_slug_on_insert() CASCADE;
CREATE OR REPLACE FUNCTION public.set_tour_slug_on_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.slug IS NULL THEN
    NEW.slug := public.generate_tour_slug(NEW.name);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_set_tour_slug_on_insert ON public.tours;
CREATE TRIGGER trigger_set_tour_slug_on_insert
BEFORE INSERT ON public.tours
FOR EACH ROW EXECUTE FUNCTION public.set_tour_slug_on_insert();
