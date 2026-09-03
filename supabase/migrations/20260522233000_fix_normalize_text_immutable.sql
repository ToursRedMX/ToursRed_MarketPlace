
CREATE OR REPLACE FUNCTION public.normalize_text(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_catalog'
AS $$
  SELECT LOWER(TRIM(
    TRANSLATE(
      input,
      'áéíóúÁÉÍÓÚñÑ',
      'aeiouAEIOUnN'
    )
  ));
$$;
