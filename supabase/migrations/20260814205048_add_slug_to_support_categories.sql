-- Part 8: Add slug column to support_categories for stable identification
-- Replaces fragile substring matching on category names
ALTER TABLE public.support_categories ADD COLUMN IF NOT EXISTS slug text;

-- Set slugs for existing categories
UPDATE public.support_categories SET slug = 'cuenta-acceso' WHERE nombre = 'Cuenta y Acceso';
UPDATE public.support_categories SET slug = 'pagos-tarjetas' WHERE nombre = 'Pagos y Tarjetas';
UPDATE public.support_categories SET slug = 'tours-reservas' WHERE nombre = 'Tours y Reservas';
UPDATE public.support_categories SET slug = 'soporte-general' WHERE nombre = 'Soporte General';
UPDATE public.support_categories SET slug = 'pagos-comisiones' WHERE nombre = 'Pagos de Comisiones';
UPDATE public.support_categories SET slug = 'apelacion-rechazo' WHERE nombre = 'Apelación de rechazo de registro';

-- Add unique constraint on slug
CREATE UNIQUE INDEX IF NOT EXISTS support_categories_slug_unique
  ON public.support_categories (slug) WHERE slug IS NOT NULL;