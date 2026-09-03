-- Función RPC transaccional para completar el onboarding de agencia.
-- SECURITY DEFINER: opera con privilegios del owner de la función.
-- El ID del usuario siempre se obtiene internamente con auth.uid().
-- Nunca acepta un user_id externo para evitar que un usuario autenticado
-- sobreescriba el perfil de otro.

CREATE OR REPLACE FUNCTION public.complete_agency_onboarding(
  -- Campos de perfil de usuario
  p_first_name              text,
  p_apellido_paterno        text,
  p_apellido_materno        text     DEFAULT NULL,
  p_date_of_birth           date     DEFAULT NULL,
  p_sexo                    text     DEFAULT NULL,
  p_curp                    text     DEFAULT NULL,
  p_phone_number            text     DEFAULT NULL,
  p_email                   text     DEFAULT NULL,
  p_profile_picture_url     text     DEFAULT NULL,
  -- Campos de agencia (campos críticos validados en servidor)
  p_agency_name             text     DEFAULT NULL,
  p_rfc                     text     DEFAULT NULL,
  p_razon_social            text     DEFAULT NULL,
  p_persona_type            text     DEFAULT NULL,
  p_representante_legal_nombre text  DEFAULT NULL,
  p_website                 text     DEFAULT NULL,
  p_contact_phone           text     DEFAULT NULL,
  p_rnt                     text     DEFAULT NULL,
  p_regimen_fiscal          text     DEFAULT NULL,
  p_banco                   text     DEFAULT NULL,
  p_cuenta_clabe            text     DEFAULT NULL,
  p_titular_cuenta          text     DEFAULT NULL,
  p_street                  text     DEFAULT NULL,
  p_exterior_number         text     DEFAULT NULL,
  p_interior_number         text     DEFAULT NULL,
  p_colony                  text     DEFAULT NULL,
  p_city                    text     DEFAULT NULL,
  p_state                   text     DEFAULT NULL,
  p_postal_code             text     DEFAULT NULL,
  p_country                 text     DEFAULT 'México'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
BEGIN
  -- 1. Obtener el ID del usuario autenticado. Nunca viene como parámetro.
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  -- 2. Validaciones de servidor para campos críticos (igual que el frontend,
  --    pero aquí no depende de que el cliente se comporte bien).
  IF p_rfc IS NULL OR trim(p_rfc) = '' THEN
    RAISE EXCEPTION 'El RFC es obligatorio';
  END IF;
  IF p_razon_social IS NULL OR trim(p_razon_social) = '' THEN
    RAISE EXCEPTION 'La razón social es obligatoria';
  END IF;
  IF p_persona_type IS NULL OR trim(p_persona_type) = '' THEN
    RAISE EXCEPTION 'El tipo de persona es obligatorio';
  END IF;
  IF p_representante_legal_nombre IS NULL OR trim(p_representante_legal_nombre) = '' THEN
    RAISE EXCEPTION 'El nombre del representante legal es obligatorio';
  END IF;
  IF p_agency_name IS NULL OR trim(p_agency_name) = '' THEN
    RAISE EXCEPTION 'El nombre de la agencia es obligatorio';
  END IF;
  IF p_website IS NULL OR trim(p_website) = '' THEN
    RAISE EXCEPTION 'El sitio web es obligatorio';
  END IF;

  -- 3. Anti-duplicado: evita crear una segunda agencia en reintentos exitosos.
  --    agencies.user_id no tiene UNIQUE constraint, esta guarda es explícita.
  IF EXISTS (SELECT 1 FROM agencies WHERE user_id = v_uid) THEN
    RAISE EXCEPTION 'Esta cuenta ya tiene una agencia registrada';
  END IF;

  -- 4. Upsert del perfil de usuario.
  --    INSERT cuando el row aún no existe (flujo OAuth sin trigger previo).
  --    DO UPDATE cuando el trigger de signUp ya creó el row (flujo email/password).
  INSERT INTO public.users (
    id,
    email,
    role,
    first_name,
    last_name,
    apellido_paterno,
    apellido_materno,
    date_of_birth,
    sexo,
    curp,
    phone_number,
    email_verified,
    onboarding_completed,
    profile_picture_url
  ) VALUES (
    v_uid,
    p_email,
    'agency',
    trim(p_first_name),
    trim(p_apellido_paterno),
    trim(p_apellido_paterno),
    NULLIF(trim(COALESCE(p_apellido_materno, '')), ''),
    p_date_of_birth,
    NULLIF(trim(COALESCE(p_sexo, '')), ''),
    NULLIF(trim(COALESCE(p_curp, '')), ''),
    NULLIF(trim(COALESCE(p_phone_number, '')), ''),
    true,
    true,
    NULLIF(trim(COALESCE(p_profile_picture_url, '')), '')
  )
  ON CONFLICT (id) DO UPDATE SET
    first_name            = trim(p_first_name),
    last_name             = trim(p_apellido_paterno),
    apellido_paterno      = trim(p_apellido_paterno),
    apellido_materno      = NULLIF(trim(COALESCE(p_apellido_materno, '')), ''),
    date_of_birth         = p_date_of_birth,
    sexo                  = NULLIF(trim(COALESCE(p_sexo, '')), ''),
    curp                  = NULLIF(trim(COALESCE(p_curp, '')), ''),
    phone_number          = NULLIF(trim(COALESCE(p_phone_number, '')), ''),
    email_verified        = true,
    onboarding_completed  = true,
    profile_picture_url   = NULLIF(trim(COALESCE(p_profile_picture_url, '')), '');

  -- 5. Crear el perfil de agencia.
  --    Si este INSERT falla, Postgres revierte automáticamente el upsert anterior.
  INSERT INTO public.agencies (
    user_id,
    name,
    contact_email,
    contact_phone,
    website,
    rfc,
    razon_social,
    persona_type,
    representante_legal_nombre,
    rnt,
    regimen_fiscal,
    banco,
    cuenta_clabe,
    titular_cuenta,
    street,
    exterior_number,
    interior_number,
    colony,
    city,
    state,
    postal_code,
    country,
    is_active
  ) VALUES (
    v_uid,
    trim(p_agency_name),
    p_email,
    NULLIF(trim(COALESCE(p_contact_phone, '')), ''),
    NULLIF(trim(COALESCE(p_website, '')), ''),
    NULLIF(trim(COALESCE(p_rfc, '')), ''),
    trim(p_razon_social),
    NULLIF(trim(COALESCE(p_persona_type, '')), ''),
    NULLIF(trim(COALESCE(p_representante_legal_nombre, '')), ''),
    NULLIF(trim(COALESCE(p_rnt, '')), ''),
    NULLIF(trim(COALESCE(p_regimen_fiscal, '')), ''),
    NULLIF(trim(COALESCE(p_banco, '')), ''),
    NULLIF(trim(COALESCE(p_cuenta_clabe, '')), ''),
    NULLIF(trim(COALESCE(p_titular_cuenta, '')), ''),
    NULLIF(trim(COALESCE(p_street, '')), ''),
    NULLIF(trim(COALESCE(p_exterior_number, '')), ''),
    NULLIF(trim(COALESCE(p_interior_number, '')), ''),
    NULLIF(trim(COALESCE(p_colony, '')), ''),
    NULLIF(trim(COALESCE(p_city, '')), ''),
    NULLIF(trim(COALESCE(p_state, '')), ''),
    NULLIF(trim(COALESCE(p_postal_code, '')), ''),
    COALESCE(NULLIF(trim(COALESCE(p_country, '')), ''), 'México'),
    true
  );

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Permisos: solo usuarios autenticados pueden invocar esta función.
GRANT EXECUTE ON FUNCTION public.complete_agency_onboarding TO authenticated;
REVOKE EXECUTE ON FUNCTION public.complete_agency_onboarding FROM anon;
