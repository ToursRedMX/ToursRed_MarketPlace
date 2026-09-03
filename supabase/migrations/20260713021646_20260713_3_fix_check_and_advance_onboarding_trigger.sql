
CREATE OR REPLACE FUNCTION public.check_and_advance_onboarding_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_agency_id      uuid;
  v_current_status text;
  v_persona_type   text;
  v_required_types text[];
  v_present_types  text[];
  v_missing        text[];
BEGIN
  v_agency_id := NEW.agency_id;

  SELECT onboarding_status, persona_type
    INTO v_current_status, v_persona_type
  FROM agencies
  WHERE id = v_agency_id;

  -- Solo actuar cuando la agencia está esperando documentos
  IF v_current_status <> 'pending_documents' THEN
    RETURN NEW;
  END IF;

  -- persona_type no capturado: nunca avanzar
  IF v_persona_type IS NULL THEN
    RETURN NEW;
  END IF;

  -- Tipos requeridos según persona_type (excluir contrato_agencia, que sigue flujo propio)
  SELECT ARRAY_AGG(key) INTO v_required_types
  FROM document_types
  WHERE required = true
    AND key <> 'contrato_agencia'
    AND applies_to IN ('ambas', v_persona_type);

  IF v_required_types IS NULL THEN
    RETURN NEW;
  END IF;

  -- Documentos presentes: existen, son current, y NO han sido rechazados
  SELECT ARRAY_AGG(DISTINCT document_type_key) INTO v_present_types
  FROM agency_documents
  WHERE agency_id  = v_agency_id
    AND is_current = true
    AND status    <> 'rejected'
    AND document_type_key <> 'contrato_agencia';

  -- Detectar faltantes
  SELECT ARRAY_AGG(t) INTO v_missing
  FROM UNNEST(v_required_types) t
  WHERE NOT (COALESCE(v_present_types, ARRAY[]::text[]) @> ARRAY[t]);

  -- Solo avanzar si no hay ningún documento faltante
  IF v_missing IS NULL OR ARRAY_LENGTH(v_missing, 1) IS NULL THEN
    UPDATE agencies
    SET onboarding_status      = 'pending_review',
        documents_completed_at = now()
    WHERE id = v_agency_id;
  END IF;

  RETURN NEW;
END;
$$;
