-- ============================================================
-- 1. TABLA: terms_versions
-- ============================================================
CREATE TABLE IF NOT EXISTS terms_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  terms_type text NOT NULL CHECK (terms_type IN ('traveler', 'agency')),
  version_number integer NOT NULL,
  title text NOT NULL,
  content text NOT NULL,
  change_summary text,
  is_active boolean NOT NULL DEFAULT false,
  published_at timestamptz NOT NULL DEFAULT now(),
  published_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (terms_type, version_number)
);

CREATE INDEX IF NOT EXISTS idx_terms_versions_type_active
  ON terms_versions(terms_type, is_active);
CREATE INDEX IF NOT EXISTS idx_terms_versions_type_number
  ON terms_versions(terms_type, version_number DESC);

ALTER TABLE terms_versions ENABLE ROW LEVEL SECURITY;

-- Lectura pública de versiones activas (necesario para signup)
CREATE POLICY "Public can read active terms versions"
  ON terms_versions
  FOR SELECT
  USING (is_active = true);

-- Admins pueden leer todas las versiones
CREATE POLICY "Admins can read all terms versions"
  ON terms_versions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
      AND users.role IN ('admin', 'super_admin')
    )
  );

-- Solo admins pueden insertar nuevas versiones
CREATE POLICY "Admins can insert terms versions"
  ON terms_versions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
      AND users.role IN ('admin', 'super_admin')
    )
  );

-- Solo admins pueden actualizar (para cambiar is_active)
CREATE POLICY "Admins can update terms versions"
  ON terms_versions
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
      AND users.role IN ('admin', 'super_admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
      AND users.role IN ('admin', 'super_admin')
    )
  );

-- Service role acceso completo
CREATE POLICY "Service role can manage terms versions"
  ON terms_versions
  FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can update terms versions"
  ON terms_versions
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- 2. TABLA: terms_acceptances (inmutable — solo INSERT)
-- ============================================================
CREATE TABLE IF NOT EXISTS terms_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  terms_version_id uuid NOT NULL REFERENCES terms_versions(id) ON DELETE RESTRICT,
  terms_type text NOT NULL CHECK (terms_type IN ('traveler', 'agency')),
  version_number integer NOT NULL,
  user_email text NOT NULL,
  ip_address text,
  user_agent text,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_terms_acceptances_user_id
  ON terms_acceptances(user_id);
CREATE INDEX IF NOT EXISTS idx_terms_acceptances_version_id
  ON terms_acceptances(terms_version_id);
CREATE INDEX IF NOT EXISTS idx_terms_acceptances_type
  ON terms_acceptances(terms_type);
CREATE INDEX IF NOT EXISTS idx_terms_acceptances_accepted_at
  ON terms_acceptances(accepted_at DESC);

ALTER TABLE terms_acceptances ENABLE ROW LEVEL SECURITY;

-- Usuarios pueden ver sus propias aceptaciones
CREATE POLICY "Users can view own terms acceptances"
  ON terms_acceptances
  FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- Admins pueden ver todos los registros de auditoría
CREATE POLICY "Admins can view all terms acceptances"
  ON terms_acceptances
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
      AND users.role IN ('admin', 'super_admin')
    )
  );

-- Usuarios autenticados pueden registrar su propia aceptación
CREATE POLICY "Users can insert own terms acceptance"
  ON terms_acceptances
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

-- Service role puede insertar (para el edge function que captura IP)
CREATE POLICY "Service role can insert terms acceptances"
  ON terms_acceptances
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- NOTA: No se crean políticas de UPDATE ni DELETE — registro inmutable

-- ============================================================
-- 3. COLUMNAS EN USERS
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'accepted_traveler_terms_version'
  ) THEN
    ALTER TABLE users ADD COLUMN accepted_traveler_terms_version integer;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'accepted_agency_terms_version'
  ) THEN
    ALTER TABLE users ADD COLUMN accepted_agency_terms_version integer;
  END IF;
END $$;

-- ============================================================
-- 4. FUNCIÓN: get_active_terms
-- ============================================================
CREATE OR REPLACE FUNCTION get_active_terms(p_type text)
RETURNS TABLE (
  id uuid,
  terms_type text,
  version_number integer,
  title text,
  content text,
  change_summary text,
  published_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    tv.id,
    tv.terms_type,
    tv.version_number,
    tv.title,
    tv.content,
    tv.change_summary,
    tv.published_at
  FROM terms_versions tv
  WHERE tv.terms_type = p_type
    AND tv.is_active = true
  LIMIT 1;
END;
$$;

-- ============================================================
-- 5. FUNCIÓN: publish_new_terms_version
-- ============================================================
CREATE OR REPLACE FUNCTION publish_new_terms_version(
  p_type text,
  p_title text,
  p_content text,
  p_change_summary text,
  p_admin_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next_version integer;
  v_new_id uuid;
BEGIN
  -- Verificar que el usuario sea admin
  IF NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = p_admin_id
    AND role IN ('admin', 'super_admin')
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  -- Calcular próximo número de versión
  SELECT COALESCE(MAX(version_number), 0) + 1
  INTO v_next_version
  FROM terms_versions
  WHERE terms_type = p_type;

  -- Desactivar versión anterior
  UPDATE terms_versions
  SET is_active = false
  WHERE terms_type = p_type AND is_active = true;

  -- Insertar nueva versión activa
  INSERT INTO terms_versions (
    terms_type,
    version_number,
    title,
    content,
    change_summary,
    is_active,
    published_at,
    published_by_user_id
  )
  VALUES (
    p_type,
    v_next_version,
    p_title,
    p_content,
    p_change_summary,
    true,
    now(),
    p_admin_id
  )
  RETURNING id INTO v_new_id;

  RETURN jsonb_build_object(
    'success', true,
    'id', v_new_id,
    'version_number', v_next_version
  );
END;
$$;

-- ============================================================
-- 6. VERSIONES INICIALES DE T&C
-- Insertar versión 1 de viajeros y versión 1 de agencias
-- con contenido inicial para que el sistema arranque funcional
-- ============================================================
INSERT INTO terms_versions (
  terms_type, version_number, title, content, change_summary,
  is_active, published_at
)
VALUES (
  'traveler',
  1,
  'Términos y Condiciones para Viajeros — ToursRed',
  '<h1>Términos y Condiciones para Viajeros</h1>
<p><strong>Última actualización:</strong> Mayo 2026 | <strong>Versión 1.0</strong></p>

<h2>1. Aceptación de los Términos</h2>
<p>Al registrarte en ToursRed como viajero, aceptas expresamente estos Términos y Condiciones. Debes ser mayor de 18 años o contar con autorización de tu tutor legal. Si no estás de acuerdo con estos términos, no utilices la plataforma.</p>

<h2>2. Descripción del Servicio</h2>
<p>ToursRed es una plataforma tecnológica que conecta a viajeros con agencias de turismo registradas en México. No somos una agencia de viajes; actuamos como intermediarios facilitando la búsqueda, reserva y pago de tours y actividades turísticas.</p>

<h2>3. Registro de Cuenta</h2>
<p>Para usar la plataforma debes proporcionar información verídica y actualizada. Eres responsable de mantener la confidencialidad de tus credenciales. ToursRed puede suspender cuentas con información falsa o actividad fraudulenta.</p>

<h2>4. Reservas y Pagos</h2>
<p>Al realizar una reserva aceptas pagar el anticipo correspondiente al tour seleccionado. Los pagos se procesan a través de proveedores autorizados (Stripe, MercadoPago, PayPal). ToursRed cobra un cargo por servicio sobre cada transacción, el cual no es reembolsable.</p>

<h2>5. Política de Cancelaciones</h2>
<ul>
  <li><strong>15 días o más antes del tour:</strong> Reembolso del 100% del anticipo.</li>
  <li><strong>7 a 14 días antes del tour:</strong> Reembolso del 50% del anticipo.</li>
  <li><strong>Menos de 7 días:</strong> Sin reembolso del anticipo del tour.</li>
  <li>El cargo por servicio nunca es reembolsable.</li>
  <li>Los montos se acreditan como ToursRed Cash en tu billetera virtual.</li>
</ul>

<h2>6. Responsabilidades del Viajero</h2>
<p>El viajero es responsable de verificar los requisitos de documentación, visas, vacunas u otros requisitos del destino. ToursRed no se hace responsable por cancelaciones derivadas de documentación insuficiente o vencida.</p>

<h2>7. Limitación de Responsabilidad</h2>
<p>ToursRed actúa como intermediario tecnológico. La responsabilidad por la prestación del servicio turístico recae directamente en la agencia contratada. ToursRed no garantiza la calidad del servicio ni se hace responsable por daños, lesiones o pérdidas durante el tour.</p>

<h2>8. Protección de Datos</h2>
<p>El tratamiento de tus datos personales se rige por nuestro <a href="/aviso-privacidad">Aviso de Privacidad</a>, conforme a la Ley Federal de Protección de Datos Personales en Posesión de los Particulares (LFPDPPP).</p>

<h2>9. Modificaciones</h2>
<p>ToursRed se reserva el derecho de modificar estos términos en cualquier momento. Cuando ocurra una modificación, se te notificará al iniciar sesión y deberás aceptar explícitamente la nueva versión para continuar usando la plataforma.</p>

<h2>10. Ley Aplicable</h2>
<p>Estos términos se rigen por las leyes de los Estados Unidos Mexicanos. Para cualquier controversia, las partes se someten a los tribunales competentes de la Ciudad de México.</p>

<h2>11. Contacto</h2>
<p>Para cualquier aclaración escríbenos a: <strong>contacto@toursred.com</strong></p>',
  'Versión inicial del sistema de Términos y Condiciones para Viajeros.',
  true,
  now()
)
ON CONFLICT (terms_type, version_number) DO NOTHING;

INSERT INTO terms_versions (
  terms_type, version_number, title, content, change_summary,
  is_active, published_at
)
VALUES (
  'agency',
  1,
  'Términos y Condiciones para Agencias de Turismo — ToursRed',
  '<h1>Términos y Condiciones para Agencias de Turismo</h1>
<p><strong>Última actualización:</strong> Mayo 2026 | <strong>Versión 1.0</strong></p>

<h2>1. Aceptación de los Términos</h2>
<p>Al registrar tu agencia en ToursRed aceptas estos Términos y Condiciones en su totalidad. El representante que realiza el registro debe contar con facultades legales para obligar a la empresa. Si no estás de acuerdo, no utilices la plataforma.</p>

<h2>2. Requisitos de Registro</h2>
<p>Para operar en ToursRed las agencias deben proporcionar: RFC válido y vigente, Razón Social, Número de Registro Nacional de Turismo (RNT) cuando aplique, datos de contacto verídicos y documentación que acredite la personalidad jurídica. ToursRed se reserva el derecho de aprobar o rechazar solicitudes de registro.</p>

<h2>3. Obligaciones de la Agencia</h2>
<ul>
  <li>Publicar información veraz, actualizada y completa sobre sus tours.</li>
  <li>Cumplir con la normatividad turística federal, estatal y municipal.</li>
  <li>Mantener vigentes todas las pólizas de seguro requeridas por ley.</li>
  <li>Operar con guías certificados cuando la regulación lo exija.</li>
  <li>Respetar las políticas de cancelación publicadas en la plataforma.</li>
  <li>Emitir CFDI válidos por los servicios prestados cuando aplique.</li>
</ul>

<h2>4. Comisiones y Pagos</h2>
<p>ToursRed cobra una comisión sobre el valor de cada reserva confirmada, más un cargo por servicio al viajero. El porcentaje de comisión vigente se especifica en la sección de configuración de tu cuenta. Los pagos a agencias se realizan mediante transferencia bancaria una vez completado el tour y transcurrido el período de retención aplicable.</p>

<h2>5. Cancelaciones por Agencia</h2>
<p>Si la agencia cancela un tour con reservas activas, deberá emitir reembolso completo (100%) a todos los viajeros afectados a través de la plataforma. La cancelación reiterada de tours por parte de la agencia puede resultar en la suspensión de la cuenta.</p>

<h2>6. Propiedad Intelectual</h2>
<p>Al publicar contenido en ToursRed (imágenes, descripciones, itinerarios), la agencia garantiza ser titular de los derechos o contar con las licencias necesarias y otorga a ToursRed una licencia no exclusiva para utilizarlo con fines de promoción.</p>

<h2>7. Confidencialidad</h2>
<p>Ambas partes se comprometen a mantener confidenciales los datos comerciales, tarifas y estrategias que conozcan en virtud de su relación con la plataforma.</p>

<h2>8. Limitación de Responsabilidad</h2>
<p>ToursRed provee la plataforma tecnológica. La responsabilidad por incidentes, lesiones o daños durante el tour recae exclusivamente en la agencia operadora. La agencia exime a ToursRed de cualquier reclamación derivada de la prestación del servicio turístico.</p>

<h2>9. Protección de Datos</h2>
<p>Los datos de la agencia y sus representantes se tratan conforme a la LFPDPPP y nuestro <a href="/aviso-privacidad">Aviso de Privacidad</a>.</p>

<h2>10. Modificaciones</h2>
<p>ToursRed se reserva el derecho de modificar estos términos. Cuando ocurra una modificación, se notificará al representante de la agencia al iniciar sesión y deberá aceptar explícitamente la nueva versión para continuar operando.</p>

<h2>11. Terminación</h2>
<p>Cualquiera de las partes puede terminar la relación con 30 días de aviso. ToursRed puede suspender cuentas inmediatamente ante incumplimiento grave, fraude o resolución judicial.</p>

<h2>12. Ley Aplicable</h2>
<p>Estos términos se rigen por las leyes de los Estados Unidos Mexicanos. Para controversias, las partes se someten a los tribunales de la Ciudad de México.</p>

<h2>13. Contacto</h2>
<p>Para aclaraciones: <strong>agencias@toursred.com</strong></p>',
  'Versión inicial del sistema de Términos y Condiciones para Agencias.',
  true,
  now()
)
ON CONFLICT (terms_type, version_number) DO NOTHING;
