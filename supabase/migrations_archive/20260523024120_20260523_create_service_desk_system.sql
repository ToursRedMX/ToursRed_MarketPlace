-- ============================================================
-- TIPOS ENUM
-- ============================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'support_ticket_status') THEN
    CREATE TYPE support_ticket_status AS ENUM (
      'sin_atender',
      'en_proceso',
      'escalado',
      'resuelto',
      'cancelado',
      'duplicado'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'support_ticket_priority') THEN
    CREATE TYPE support_ticket_priority AS ENUM (
      'baja',
      'media',
      'alta',
      'urgente'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'support_ticket_type') THEN
    CREATE TYPE support_ticket_type AS ENUM (
      'traveler',
      'agency',
      'general'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'support_comment_type') THEN
    CREATE TYPE support_comment_type AS ENUM (
      'interno',
      'respuesta_usuario'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'support_history_event_type') THEN
    CREATE TYPE support_history_event_type AS ENUM (
      'creacion',
      'cambio_status',
      'cambio_prioridad',
      'asignacion_agente',
      'reasignacion_agente',
      'asignacion_agencia',
      'reasignacion_agencia',
      'comentario_interno',
      'respuesta_usuario',
      'comentario_usuario',
      'cierre'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'support_agent_role') THEN
    CREATE TYPE support_agent_role AS ENUM (
      'super_admin',
      'supervisor',
      'agente',
      'lectura'
    );
  END IF;
END $$;

-- ============================================================
-- TABLA: support_categories
-- ============================================================

CREATE TABLE IF NOT EXISTS support_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL,
  descripcion text DEFAULT '',
  activa boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE support_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read active support categories"
  ON support_categories FOR SELECT
  USING (activa = true);

CREATE POLICY "Admins manage support categories"
  ON support_categories FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

CREATE POLICY "Admins update support categories"
  ON support_categories FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

CREATE POLICY "Admins delete support categories"
  ON support_categories FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- ============================================================
-- TABLA: support_subcategories
-- ============================================================

CREATE TABLE IF NOT EXISTS support_subcategories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES support_categories(id) ON DELETE CASCADE,
  nombre text NOT NULL,
  descripcion text DEFAULT '',
  nomenclatura text NOT NULL,
  prioridad_default support_ticket_priority DEFAULT 'media',
  sla_horas integer DEFAULT 24,
  aplica_a text[] DEFAULT ARRAY['general'],
  permite_adjuntos boolean DEFAULT true,
  activa boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT nomenclatura_format CHECK (nomenclatura ~ '^[A-Z]{2,6}$')
);

CREATE INDEX IF NOT EXISTS idx_support_subcategories_category_id ON support_subcategories(category_id);

ALTER TABLE support_subcategories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read active support subcategories"
  ON support_subcategories FOR SELECT
  USING (activa = true);

CREATE POLICY "Admins manage support subcategories"
  ON support_subcategories FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

CREATE POLICY "Admins update support subcategories"
  ON support_subcategories FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

CREATE POLICY "Admins delete support subcategories"
  ON support_subcategories FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- ============================================================
-- TABLA: support_tickets
-- ============================================================

CREATE TABLE IF NOT EXISTS support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  folio text NOT NULL UNIQUE,
  tipo support_ticket_type NOT NULL DEFAULT 'general',
  category_id uuid NOT NULL REFERENCES support_categories(id),
  subcategory_id uuid NOT NULL REFERENCES support_subcategories(id),
  prioridad support_ticket_priority NOT NULL DEFAULT 'media',
  status support_ticket_status NOT NULL DEFAULT 'sin_atender',
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  solicitante_nombre text NOT NULL,
  solicitante_email text NOT NULL,
  descripcion text NOT NULL,
  agente_asignado_id uuid REFERENCES users(id) ON DELETE SET NULL,
  agencia_asignada_id uuid REFERENCES agencies(id) ON DELETE SET NULL,
  ticket_relacionado_id uuid REFERENCES support_tickets(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  closed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_user_id ON support_tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets(status);
CREATE INDEX IF NOT EXISTS idx_support_tickets_prioridad ON support_tickets(prioridad);
CREATE INDEX IF NOT EXISTS idx_support_tickets_tipo ON support_tickets(tipo);
CREATE INDEX IF NOT EXISTS idx_support_tickets_category_id ON support_tickets(category_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_subcategory_id ON support_tickets(subcategory_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_agente_asignado_id ON support_tickets(agente_asignado_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_agencia_asignada_id ON support_tickets(agencia_asignada_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_created_at ON support_tickets(created_at DESC);

ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;

-- Usuarios registrados ven sus propios tickets
CREATE POLICY "Users view own tickets"
  ON support_tickets FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Agencias ven tickets asignados a ellas
CREATE POLICY "Agencies view assigned tickets"
  ON support_tickets FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users u
      JOIN agencies a ON a.user_id = u.id
      WHERE u.id = auth.uid()
      AND a.id = support_tickets.agencia_asignada_id
    )
  );

-- Admins ven todos los tickets
CREATE POLICY "Admins view all tickets"
  ON support_tickets FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- Cualquiera puede insertar tickets (incluye usuarios no registrados via service role)
CREATE POLICY "Anyone can insert tickets"
  ON support_tickets FOR INSERT
  WITH CHECK (true);

-- Admins pueden actualizar tickets
CREATE POLICY "Admins update tickets"
  ON support_tickets FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- ============================================================
-- TABLA: support_ticket_comments
-- ============================================================

CREATE TABLE IF NOT EXISTS support_ticket_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author_id uuid REFERENCES users(id) ON DELETE SET NULL,
  author_name text NOT NULL,
  tipo support_comment_type NOT NULL DEFAULT 'respuesta_usuario',
  contenido text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_support_ticket_comments_ticket_id ON support_ticket_comments(ticket_id);

ALTER TABLE support_ticket_comments ENABLE ROW LEVEL SECURITY;

-- Usuarios ven comentarios de respuesta_usuario en sus tickets
CREATE POLICY "Users view response comments on own tickets"
  ON support_ticket_comments FOR SELECT
  TO authenticated
  USING (
    tipo = 'respuesta_usuario'
    AND EXISTS (
      SELECT 1 FROM support_tickets st
      WHERE st.id = ticket_id
      AND st.user_id = auth.uid()
    )
  );

-- Agencias ven comentarios de respuesta_usuario en tickets asignados a ellas
CREATE POLICY "Agencies view response comments on assigned tickets"
  ON support_ticket_comments FOR SELECT
  TO authenticated
  USING (
    tipo = 'respuesta_usuario'
    AND EXISTS (
      SELECT 1 FROM support_tickets st
      JOIN agencies a ON a.id = st.agencia_asignada_id
      JOIN users u ON u.id = a.user_id
      WHERE st.id = ticket_id
      AND u.id = auth.uid()
    )
  );

-- Admins ven todos los comentarios
CREATE POLICY "Admins view all comments"
  ON support_ticket_comments FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- Usuarios registrados pueden insertar comentarios en sus tickets
CREATE POLICY "Authenticated users insert comments on own tickets"
  ON support_ticket_comments FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM support_tickets st
      WHERE st.id = ticket_id
      AND (
        st.user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin'
        )
        OR EXISTS (
          SELECT 1 FROM agencies a JOIN users u ON u.id = a.user_id
          WHERE u.id = auth.uid() AND a.id = st.agencia_asignada_id
        )
      )
    )
  );

-- ============================================================
-- TABLA: support_ticket_attachments
-- ============================================================

CREATE TABLE IF NOT EXISTS support_ticket_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  nombre_archivo text NOT NULL,
  mime_type text NOT NULL,
  tamano_bytes integer NOT NULL DEFAULT 0,
  subido_por_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_support_ticket_attachments_ticket_id ON support_ticket_attachments(ticket_id);

ALTER TABLE support_ticket_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view attachments on own tickets"
  ON support_ticket_attachments FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM support_tickets st
      WHERE st.id = ticket_id
      AND (
        st.user_id = auth.uid()
        OR EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')
        OR EXISTS (
          SELECT 1 FROM agencies a JOIN users u ON u.id = a.user_id
          WHERE u.id = auth.uid() AND a.id = st.agencia_asignada_id
        )
      )
    )
  );

CREATE POLICY "Authenticated insert attachments"
  ON support_ticket_attachments FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- ============================================================
-- TABLA: support_ticket_history
-- ============================================================

CREATE TABLE IF NOT EXISTS support_ticket_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  tipo_evento support_history_event_type NOT NULL,
  descripcion text NOT NULL,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_name text,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_support_ticket_history_ticket_id ON support_ticket_history(ticket_id);
CREATE INDEX IF NOT EXISTS idx_support_ticket_history_created_at ON support_ticket_history(created_at DESC);

ALTER TABLE support_ticket_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view history of own tickets"
  ON support_ticket_history FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM support_tickets st
      WHERE st.id = ticket_id
      AND (
        st.user_id = auth.uid()
        OR EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')
        OR EXISTS (
          SELECT 1 FROM agencies a JOIN users u ON u.id = a.user_id
          WHERE u.id = auth.uid() AND a.id = st.agencia_asignada_id
        )
      )
    )
  );

CREATE POLICY "System inserts history events"
  ON support_ticket_history FOR INSERT
  WITH CHECK (true);

-- ============================================================
-- TABLA: support_agent_permissions
-- ============================================================

CREATE TABLE IF NOT EXISTS support_agent_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rol_soporte support_agent_role NOT NULL DEFAULT 'agente',
  activo boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_support_agent_permissions_user_id ON support_agent_permissions(user_id);

ALTER TABLE support_agent_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage agent permissions"
  ON support_agent_permissions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

CREATE POLICY "Admins insert agent permissions"
  ON support_agent_permissions FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

CREATE POLICY "Admins update agent permissions"
  ON support_agent_permissions FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

CREATE POLICY "Admins delete agent permissions"
  ON support_agent_permissions FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- Agentes pueden ver su propio registro
CREATE POLICY "Agents view own permissions"
  ON support_agent_permissions FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- ============================================================
-- FUNCIÓN: generate_ticket_folio
-- Genera folio único tipo NOMENCLATURA-0000001
-- ============================================================

CREATE OR REPLACE FUNCTION generate_ticket_folio(p_subcategory_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

  SELECT COUNT(*) + 1 INTO v_count
  FROM support_tickets
  WHERE folio LIKE v_nomenclatura || '-%'
  FOR UPDATE;

  v_folio := v_nomenclatura || '-' || LPAD(v_count::text, 7, '0');

  WHILE EXISTS (SELECT 1 FROM support_tickets WHERE folio = v_folio) LOOP
    v_count := v_count + 1;
    v_folio := v_nomenclatura || '-' || LPAD(v_count::text, 7, '0');
  END LOOP;

  RETURN v_folio;
END;
$$;

-- ============================================================
-- FUNCIÓN: update_support_ticket_updated_at
-- Actualiza updated_at automáticamente
-- ============================================================

CREATE OR REPLACE FUNCTION update_support_ticket_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_support_tickets_updated_at
  BEFORE UPDATE ON support_tickets
  FOR EACH ROW EXECUTE FUNCTION update_support_ticket_updated_at();

CREATE TRIGGER trg_support_categories_updated_at
  BEFORE UPDATE ON support_categories
  FOR EACH ROW EXECUTE FUNCTION update_support_ticket_updated_at();

CREATE TRIGGER trg_support_subcategories_updated_at
  BEFORE UPDATE ON support_subcategories
  FOR EACH ROW EXECUTE FUNCTION update_support_ticket_updated_at();

CREATE TRIGGER trg_support_agent_permissions_updated_at
  BEFORE UPDATE ON support_agent_permissions
  FOR EACH ROW EXECUTE FUNCTION update_support_ticket_updated_at();

-- ============================================================
-- DATOS INICIALES — Categorías y subcategorías predeterminadas
-- ============================================================

DO $$
DECLARE
  v_cat_cuenta uuid;
  v_cat_pagos uuid;
  v_cat_tours uuid;
  v_cat_general uuid;
BEGIN
  INSERT INTO support_categories (nombre, descripcion, activa)
  VALUES ('Cuenta y Acceso', 'Problemas con registro, inicio de sesion y recuperacion de contrasena', true)
  RETURNING id INTO v_cat_cuenta;

  INSERT INTO support_categories (nombre, descripcion, activa)
  VALUES ('Pagos y Tarjetas', 'Problemas relacionados con pagos y tarjetas de regalo', true)
  RETURNING id INTO v_cat_pagos;

  INSERT INTO support_categories (nombre, descripcion, activa)
  VALUES ('Tours y Reservas', 'Dudas o problemas con tours y reservaciones', true)
  RETURNING id INTO v_cat_tours;

  INSERT INTO support_categories (nombre, descripcion, activa)
  VALUES ('Soporte General', 'Dudas generales del sitio', true)
  RETURNING id INTO v_cat_general;

  INSERT INTO support_subcategories (category_id, nombre, descripcion, nomenclatura, prioridad_default, sla_horas, aplica_a, permite_adjuntos)
  VALUES
    (v_cat_cuenta, 'No puedo registrarme', 'El usuario no puede completar el proceso de registro', 'REG', 'alta', 12, ARRAY['general'], false),
    (v_cat_cuenta, 'No puedo iniciar sesion', 'El usuario no puede acceder a su cuenta', 'ACC', 'alta', 8, ARRAY['general'], false),
    (v_cat_cuenta, 'Recuperacion de contrasena', 'Problemas con el flujo de recuperacion de contrasena', 'PWD', 'alta', 8, ARRAY['general'], false),
    (v_cat_pagos, 'Problema con tarjeta de regalo', 'Problemas en la compra o canje de tarjetas de regalo', 'GFT', 'media', 24, ARRAY['general', 'traveler'], true),
    (v_cat_pagos, 'Problema con pago de reserva', 'El pago de una reserva fallo o no se proceso', 'PAG', 'alta', 8, ARRAY['traveler'], true),
    (v_cat_tours, 'Problema con mi reserva', 'Dudas o incidencias relacionadas con una reserva especifica', 'RES', 'media', 24, ARRAY['traveler'], true),
    (v_cat_tours, 'Problema con tour publicado', 'Incidencia en la publicacion o gestion de un tour', 'TUR', 'media', 24, ARRAY['agency'], true),
    (v_cat_general, 'Duda general del sitio', 'Preguntas generales sobre la plataforma', 'DUD', 'baja', 48, ARRAY['general', 'traveler', 'agency'], false);
END $$;
