-- Fixture compartido de las pruebas de movimientos financieros.
--
-- Vive aparte porque lo usan DOS pruebas: `test-vista-movimientos.sql`, que
-- comprueba como reparte la vista cada concepto, y `test-gastos-operacion.sql`,
-- que comprueba la captura de gastos. Las dos cargan la MISMA migracion de la
-- vista, asi que las dos necesitan las mismas 20 tablas de utileria. Duplicarlo
-- garantizaba que un dia se despegaran.
--
-- No contiene ninguna afirmacion. Solo crea el esquema y mete datos.
-- Los gastos NO estan aqui: `gastos_operacion` no existe hasta que corre la
-- migracion, asi que cada prueba mete los suyos despues de cargarla.
-- Supabase trae estos tres roles de fabrica; un Postgres pelado no. La
-- migracion les concede permisos y esta bien que lo haga: quien tiene que
-- parecerse al entorno real es la prueba, no al reves. Sin ellos el `GRANT`
-- revienta con 'role "anon" does not exist' y la prueba no llega ni a empezar.
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon')          THEN CREATE ROLE anon          NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role')  THEN CREATE ROLE service_role  NOLOGIN; END IF;
END $roles$;

DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
SET search_path = public;

-- Recrear el esquema borra el `GRANT USAGE ON SCHEMA public TO PUBLIC` que
-- initdb deja puesto. Sin devolverlo, cualquier prueba que haga `SET ROLE
-- authenticated` ve "relation does not exist" en vez del error de permisos que
-- venia a comprobar, y eso se lee como si la prueba pasara.
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Fixture: solo las columnas que la vista toca.
-- ---------------------------------------------------------------------------
CREATE TABLE agencies (id uuid PRIMARY KEY, name text);
CREATE TABLE users    (id uuid PRIMARY KEY, first_name text, last_name text);
CREATE TABLE bookings (id uuid PRIMARY KEY, booking_code text, agency_id uuid, status text);

CREATE TABLE payment_transactions (
  id uuid PRIMARY KEY, booking_id uuid, amount numeric, status text,
  processor_fee numeric, charge_context text, payment_processor text,
  created_at timestamptz);

CREATE TABLE openpay_wallet_topups (
  id uuid PRIMARY KEY, user_id uuid, amount numeric, status text, created_at timestamptz);

CREATE TABLE gift_cards (
  id uuid PRIMARY KEY, code text, amount numeric, payment_status text,
  payment_provider text, purchaser_email text, purchased_at timestamptz);

CREATE TABLE booking_optional_services (
  id uuid PRIMARY KEY, booking_id uuid, description text, payment_method text,
  total_paid numeric, paid_at timestamptz, created_at timestamptz);

CREATE TABLE booking_supplements (
  id uuid PRIMARY KEY, booking_id uuid, total_paid numeric, created_at timestamptz);

CREATE TABLE featured_tour_slots (
  id uuid PRIMARY KEY, agency_id uuid, total_amount numeric,
  payment_provider text, payment_confirmed_at timestamptz);

CREATE TABLE commission_records (
  id uuid PRIMARY KEY, booking_id uuid, agency_id uuid,
  platform_total_revenue numeric, status text,
  processed_at timestamptz, created_at timestamptz);

CREATE TABLE insurance_commission_receipts (
  id uuid PRIMARY KEY, provider_name text, amount numeric,
  invoice_reference text, receipt_date timestamptz);

CREATE TABLE agency_payouts (
  id uuid PRIMARY KEY, agency_id uuid, amount numeric, status text,
  payment_date timestamptz, payout_code text, payment_method text);

CREATE TABLE toursred_cash_transactions (
  id uuid PRIMARY KEY, user_id uuid, amount numeric, type text,
  reference_type text, reference_id uuid, created_at timestamptz);

CREATE TABLE executive_commissions (
  id uuid PRIMARY KEY, agency_id uuid, amount numeric, status text,
  commission_type text, payment_reference text,
  paid_at timestamptz, created_at timestamptz);

CREATE TABLE toursred_points_transactions (
  id uuid PRIMARY KEY, user_id uuid, amount integer, type text,
  reference_type text, created_at timestamptz);

CREATE TABLE insurance_settlements (
  id uuid PRIMARY KEY, provider_name text, amount numeric,
  reference text, payment_date timestamptz);

CREATE TABLE payment_refunds (
  id uuid PRIMARY KEY, booking_id uuid, requested_amount numeric,
  processor_refund_fee numeric, processor_fee_lost numeric,
  refund_method text, payment_processor text, status text,
  confirmed_at timestamptz, processed_at timestamptz, created_at timestamptz);

CREATE TABLE payment_disputes (id uuid PRIMARY KEY, amount numeric, created_at timestamptz);

-- ---------------------------------------------------------------------------
-- Datos. Cifras chicas y distintas entre si para que cualquier suma equivocada
-- de un numero reconocible en vez de cuadrar por casualidad.
-- ---------------------------------------------------------------------------
INSERT INTO agencies VALUES ('a0000000-0000-0000-0000-000000000001','Agencia Uno');
INSERT INTO users    VALUES ('c0000000-0000-0000-0000-000000000001','Ana','Viajera');

INSERT INTO bookings VALUES
  ('b0000000-0000-0000-0000-000000000001','RES-VIVA',   'a0000000-0000-0000-0000-000000000001','confirmed'),
  ('b0000000-0000-0000-0000-000000000002','RES-CANC-V', 'a0000000-0000-0000-0000-000000000001','cancelled'),
  ('b0000000-0000-0000-0000-000000000003','RES-CANC-P', 'a0000000-0000-0000-0000-000000000001','cancelled'),
  ('b0000000-0000-0000-0000-000000000004','RES-MONEDERO','a0000000-0000-0000-0000-000000000001','confirmed'),
  ('b0000000-0000-0000-0000-000000000005','RES-VIVA-ANULADA','a0000000-0000-0000-0000-000000000001','confirmed');

-- Anticipo de 5,000 por tarjeta, con 50 de comision de procesador.
INSERT INTO payment_transactions VALUES
  ('d0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000001',
   5000,'succeeded',50,'booking_deposit','stripe','2026-09-01');

-- Reconocimiento sobre la reserva viva: 750.
INSERT INTO commission_records VALUES
  ('e0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-000000000001',750,'processed','2026-09-01','2026-09-01'),
  -- TRAMPA 2a: cancelada Y anulada. 111 no debe aparecer.
  ('e0000000-0000-0000-0000-000000000002','b0000000-0000-0000-0000-000000000002',
   'a0000000-0000-0000-0000-000000000001',111,'voided','2026-09-02','2026-09-02'),
  -- TRAMPA 2b: cancelada pero SIN anular. 222 tampoco debe aparecer.
  ('e0000000-0000-0000-0000-000000000003','b0000000-0000-0000-0000-000000000003',
   'a0000000-0000-0000-0000-000000000001',222,'processed','2026-09-03','2026-09-03'),
  -- TRAMPA 2c: reserva VIVA con el registro anulado (una correccion, por
  -- ejemplo). Esta fila es la que hace que el filtro de `voided` se ejercite
  -- de verdad: sin ella, el filtro de reservas canceladas ya tapaba a la 2a y
  -- quitar el de `voided` no rompia nada -- comprobado con una mutacion que
  -- sobrevivio. 444 no debe aparecer.
  ('e0000000-0000-0000-0000-000000000004','b0000000-0000-0000-0000-000000000005',
   'a0000000-0000-0000-0000-000000000001',444,'voided','2026-09-03','2026-09-03');

-- TRAMPA 1: recarga de 1,000 y despues una reserva de 400 pagada con ese saldo.
INSERT INTO toursred_cash_transactions VALUES
  -- Recarga por SPEI: dinero nuevo al banco.
  ('10000000-0000-0000-0000-000000000003','c0000000-0000-0000-0000-000000000001',
   1000,'topup_spei','openpay_spei_topup',NULL,'2026-09-04'),
  -- Reserva pagada con ese saldo: NO es caja nueva.
  ('10000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001',
   -400,'debit','booking','b0000000-0000-0000-0000-000000000004','2026-09-05'),
  -- Reembolso al monedero: no sale del banco.
  ('10000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-000000000001',
   333,'refund','booking_cancellation','b0000000-0000-0000-0000-000000000002','2026-09-06'),
  -- Canje de tarjeta de regalo: el pasivo solo cambia de cuenta.
  ('10000000-0000-0000-0000-000000000004','c0000000-0000-0000-0000-000000000001',
   200,'gift_card','gift_card',NULL,'2026-09-06'),
  -- Saldo de promocion: no entra dinero, pero se crea deuda y eso cuesta.
  ('10000000-0000-0000-0000-000000000005','c0000000-0000-0000-0000-000000000001',
   150,'promotion','campana',NULL,'2026-09-06');

-- Liberacion a la agencia: esto SI sale del banco.
INSERT INTO agency_payouts VALUES
  ('20000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001',
   2000,'completed','2026-09-07','PAY-1','spei');

-- Los bloques que faltaban por ejercitar. Sin una fila aqui, romper esos
-- bloques no rompe nada y la mutacion sobrevive -- comprobado: la de la tarjeta
-- de regalo sobrevivio justo por esto.
INSERT INTO gift_cards VALUES
  ('60000000-0000-0000-0000-000000000001','GC-1',500,'paid','stripe','ana@x.mx','2026-09-08');
INSERT INTO booking_optional_services VALUES
  ('61000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000001',
   'Snorkel','stripe',120,'2026-09-08','2026-09-08');
INSERT INTO booking_supplements VALUES
  ('62000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000001',70,'2026-09-08');
INSERT INTO insurance_commission_receipts VALUES
  ('63000000-0000-0000-0000-000000000001','Aseguradora X',450,'FAC-1','2026-09-08');
INSERT INTO insurance_settlements VALUES
  ('64000000-0000-0000-0000-000000000001','Aseguradora X',300,'LIQ-1','2026-09-08');
INSERT INTO payment_disputes VALUES
  ('65000000-0000-0000-0000-000000000001',210,'2026-09-08');

-- Una membresia: producto propio de ToursRed. Ni un peso de pasivo.
INSERT INTO payment_transactions VALUES
  ('d0000000-0000-0000-0000-000000000002',NULL,
   800,'succeeded',0,'membership','stripe','2026-09-09');

-- Comisiones de ejecutivo: una pagada y una pendiente. La pendiente es gasto
-- YA y ademas es dinero que se debe.
INSERT INTO executive_commissions VALUES
  ('50000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001',
   60,'paid','approval','REF-1','2026-09-09','2026-09-09'),
  ('50000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000001',
   90,'pending','platform_period',NULL,NULL,'2026-09-09');

-- Reembolso al METODO DE PAGO ORIGINAL: este si sale del banco. Es el caso
-- excepcional (una disputa de PROFECO, por ejemplo) que se hace desde el panel
-- de admin. `processor_fee_lost` de 30 esta puesto A PROPOSITO para comprobar
-- que NO se cuenta: esa comision es la del cobro original y ya se conto cuando
-- entro el dinero.
INSERT INTO payment_refunds VALUES
  ('40000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000001',
   1500, 25, 30, 'original_payment_method','stripe','succeeded','2026-09-09',NULL,'2026-09-09'),
  -- Uno todavia sin confirmar: no ha movido el banco, no debe aparecer.
  ('40000000-0000-0000-0000-000000000002','b0000000-0000-0000-0000-000000000001',
   999, 0, 0, 'original_payment_method','stripe','pending',NULL,NULL,'2026-09-09');

-- Tour destacado: ingreso integro, sin pasivo.
INSERT INTO featured_tour_slots VALUES
  ('30000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001',
   900,'stripe','2026-09-08');

-- ---------------------------------------------------------------------------
-- Utileria que en Supabase ya viene puesta y en un Postgres pelado no.
-- La migracion de gastos la usa; sin esto ni siquiera carga.
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS auth;

-- El usuario "conectado" se guarda en una variable de sesion para que cada
-- caso pueda cambiar de identidad con `set_config`. Devolver un uuid fijo
-- haria imposible probar que un usuario sin permiso NO puede.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('prueba.usuario', true), '')::uuid;
$$;

ALTER TABLE users ADD COLUMN IF NOT EXISTS role text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_super_admin boolean DEFAULT false;

CREATE TABLE admin_permissions (
  user_id uuid PRIMARY KEY REFERENCES users(id),
  can_view_accounting boolean NOT NULL DEFAULT false);

-- Copia fiel de la de produccion en lo que importa aqui: mira el rol Y
-- descarta a los bloqueados.
CREATE OR REPLACE FUNCTION current_user_has_role(p_roles text[]) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM users u
                  WHERE u.id = auth.uid()
                    AND u.role = ANY(p_roles)
                    AND coalesce(u.is_active, true) = true);
$$;

CREATE TABLE chart_of_accounts (
  code text PRIMARY KEY,
  name text NOT NULL,
  account_type text NOT NULL,
  is_active boolean NOT NULL DEFAULT true);

INSERT INTO chart_of_accounts VALUES
  ('102',    'Bancos',                    'activo', true),
  ('108',    'IVA Acreditable',           'activo', true),
  ('205',    'Acreedores diversos',       'pasivo', true),
  ('601.01', 'Gastos por servicios',      'gasto',  true),
  ('601.02', 'Gastos operativos',         'gasto',  true),
  ('602',    'Gastos de tecnologia',      'gasto',  true),
  ('604',    'Cuenta de gasto retirada',  'gasto',  false);

CREATE TABLE accounting_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_number text, entry_type text, entry_date date,
  period_year integer, period_month integer, description text,
  source_type text, source_id uuid, is_posted boolean,
  posted_at timestamptz, created_by uuid);

CREATE TABLE accounting_entry_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL REFERENCES accounting_entries(id) ON DELETE CASCADE,
  line_number integer, account_code text REFERENCES chart_of_accounts(code),
  description text,
  debit numeric(14,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit numeric(14,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  cfdi_uuid text);

-- Los triggers de inmutabilidad de `20260910000000`. NO son adorno: sin ellos
-- este fixture aceptaba UPDATE sobre polizas publicadas, y por eso las diez
-- pruebas de `test-pagar-gasto.sql` pasaron mientras produccion reventaba con
-- «Una póliza publicada es inmutable; genere una reversa». Una tabla de
-- prueba mas permisiva que la real no prueba nada: prueba otra base de datos.
CREATE OR REPLACE FUNCTION validate_posted_accounting_entry()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_debit numeric; v_credit numeric; v_lines integer;
BEGIN
  IF TG_OP = 'DELETE' AND OLD.is_posted THEN
    RAISE EXCEPTION 'Una póliza publicada no puede eliminarse; genere una reversa';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.is_posted THEN
    RAISE EXCEPTION 'Una póliza publicada es inmutable; genere una reversa';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.is_posted AND NOT OLD.is_posted THEN
    SELECT COUNT(*), COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
      INTO v_lines, v_debit, v_credit
      FROM accounting_entry_lines WHERE entry_id = NEW.id;
    IF v_lines = 0 OR v_debit <> v_credit THEN
      RAISE EXCEPTION 'La póliza publicada debe tener partidas y estar balanceada (débito %, crédito %)', v_debit, v_credit;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_posted_accounting_entry ON accounting_entries;
CREATE TRIGGER trg_validate_posted_accounting_entry
BEFORE INSERT OR UPDATE OR DELETE ON accounting_entries
FOR EACH ROW EXECUTE FUNCTION validate_posted_accounting_entry();

-- El INSERT no se valida arriba porque las RPC meten la cabecera antes que sus
-- partidas. El balance se revisa al cierre de la transaccion, diferido.
CREATE OR REPLACE FUNCTION validate_posted_accounting_entry_deferred()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_debit numeric; v_credit numeric; v_lines integer;
  v_entry_id uuid := COALESCE(NEW.id, OLD.id);
BEGIN
  IF TG_OP = 'DELETE' OR NOT COALESCE(NEW.is_posted, OLD.is_posted, false) THEN
    RETURN NULL;
  END IF;
  SELECT COUNT(*), COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
    INTO v_lines, v_debit, v_credit
    FROM accounting_entry_lines WHERE entry_id = v_entry_id;
  IF v_lines = 0 OR v_debit <> v_credit THEN
    RAISE EXCEPTION 'La póliza publicada debe tener partidas y estar balanceada (débito %, crédito %)', v_debit, v_credit;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_posted_accounting_entry_deferred ON accounting_entries;
CREATE CONSTRAINT TRIGGER trg_validate_posted_accounting_entry_deferred
AFTER INSERT OR UPDATE ON accounting_entries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_posted_accounting_entry_deferred();

CREATE OR REPLACE FUNCTION validate_posted_accounting_entry_lines()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_entry_id uuid := COALESCE(NEW.entry_id, OLD.entry_id);
  v_posted boolean; v_debit numeric; v_credit numeric; v_lines integer;
BEGIN
  SELECT is_posted INTO v_posted FROM accounting_entries WHERE id = v_entry_id;
  IF NOT COALESCE(v_posted, false) THEN RETURN NULL; END IF;

  SELECT COUNT(*), COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
    INTO v_lines, v_debit, v_credit
    FROM accounting_entry_lines WHERE entry_id = v_entry_id;
  IF v_lines = 0 OR v_debit <> v_credit THEN
    RAISE EXCEPTION 'La póliza publicada debe permanecer balanceada';
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_posted_accounting_entry_lines ON accounting_entry_lines;
CREATE CONSTRAINT TRIGGER trg_validate_posted_accounting_entry_lines
AFTER INSERT OR UPDATE OR DELETE ON accounting_entry_lines
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_posted_accounting_entry_lines();

CREATE OR REPLACE FUNCTION generate_entry_number(p_type text, p_anio integer, p_mes integer)
RETURNS text LANGUAGE sql AS $$
  SELECT upper(left(p_type,3)) || '-' || p_anio || lpad(p_mes::text,2,'0') || '-' ||
         lpad((1 + (SELECT count(*) FROM accounting_entries
                    WHERE period_year = p_anio AND period_month = p_mes))::text, 4, '0');
$$;

-- Tres usuarios para poder afirmar quien SI y quien NO.
INSERT INTO users (id, first_name, last_name, role, is_active, is_super_admin) VALUES
  ('c0000000-0000-0000-0000-0000000000a1','Conta','Autorizada','accountant',true,false),
  ('c0000000-0000-0000-0000-0000000000a2','Admin','SinPermiso','admin',     true,false),
  ('c0000000-0000-0000-0000-0000000000a3','Conta','Bloqueada', 'accountant',false,true);
