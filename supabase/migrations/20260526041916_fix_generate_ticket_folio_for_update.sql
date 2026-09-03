
CREATE OR REPLACE FUNCTION public.generate_ticket_folio(p_subcategory_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_nomenclatura text;
  v_count bigint;
  v_folio text;
BEGIN
  SELECT nomenclatura INTO v_nomenclatura
  FROM support_subcategories
  WHERE id = p_subcategory_id;

  IF v_nomenclatura IS NULL THEN
    RAISE EXCEPTION 'Subcategoria no encontrada: %', p_subcategory_id;
  END IF;

  LOCK TABLE support_tickets IN ROW EXCLUSIVE MODE;

  SELECT COUNT(*) + 1 INTO v_count
  FROM support_tickets
  WHERE folio LIKE v_nomenclatura || '-%';

  v_folio := v_nomenclatura || '-' || LPAD(v_count::text, 7, '0');

  WHILE EXISTS (SELECT 1 FROM support_tickets WHERE folio = v_folio) LOOP
    v_count := v_count + 1;
    v_folio := v_nomenclatura || '-' || LPAD(v_count::text, 7, '0');
  END LOOP;

  RETURN v_folio;
END;
$$;
