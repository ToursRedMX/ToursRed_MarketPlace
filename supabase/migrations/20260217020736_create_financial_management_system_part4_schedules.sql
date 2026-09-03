-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260217020736
--   name:    create_financial_management_system_part4_schedules
--
-- Recuperado : las sentencias ejecutadas, en su orden original.
-- Perdido    : los comentarios sueltos entre sentencias. El ledger guarda solo
--              sentencias ejecutables, asi que la documentacion que tuviera el
--              archivo original no es recuperable desde aqui.
-- Transformado: saltos de linea desescapados y ';' separadores repuestos, que
--              statements[] no conserva. La alineacion puede diferir.
--
-- Se agrega para que el cambio de esquema sea revisable y reproducible desde
-- el repo. Para el detalle de por que existe, ver el bullet del desfase de
-- migraciones en claude.md.
-- ============================================================================

/*
  # Create Financial Management System - Part 4: Payout Schedules & Integration Configs

  1. New Tables
    - `payout_schedules`
      - `id` (uuid, primary key)
      - `agency_id` (uuid, unique) - One schedule per agency
      - `frequency` (text) - weekly, biweekly, monthly
      - `day_of_week` (integer, nullable) - 1-7 for weekly (1=Monday)
      - `day_of_month` (integer, nullable) - 1-31 for monthly
      - `minimum_payout_amount` (numeric) - Minimum threshold to process payout
      - `preferred_payment_method` (text)
      - `bank_account_holder_name` (text, nullable)
      - `bank_name` (text, nullable)
      - `bank_account_number` (text, nullable)
      - `bank_clabe` (text, nullable) - For Mexican SPEI transfers
      - `bank_swift_code` (text, nullable) - For international transfers
      - `payment_currency` (text) - MXN, USD, etc.
      - `automatic_payout_enabled` (boolean) - For future automation
      - `is_active` (boolean)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

    - `integration_configs`
      - `id` (uuid, primary key)
      - `provider` (text) - zoho_books, odoo, quickbooks, bank_api, stripe_connect
      - `agency_id` (uuid, nullable) - Null for platform-wide integrations
      - `is_active` (boolean)
      - `credentials` (text) - Encrypted credentials JSON
      - `api_endpoint` (text, nullable)
      - `sync_frequency` (text) - manual, daily, weekly, real_time
      - `last_sync_at` (timestamptz, nullable)
      - `last_sync_status` (text) - success, failed, pending
      - `error_log` (jsonb, nullable)
      - `configuration` (jsonb) - Additional provider-specific config
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS on both tables
    - Agencies can view/update their own schedule
    - Only admins can manage integration configs
*/

-- Create payout_schedules table
CREATE TABLE IF NOT EXISTS payout_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL UNIQUE REFERENCES agencies(id) ON DELETE CASCADE,
  frequency text NOT NULL DEFAULT 'weekly' CHECK (frequency IN ('weekly', 'biweekly', 'monthly')),
  day_of_week integer CHECK (day_of_week BETWEEN 1 AND 7),
  day_of_month integer CHECK (day_of_month BETWEEN 1 AND 31),
  minimum_payout_amount numeric(10, 2) NOT NULL DEFAULT 500.00 CHECK (minimum_payout_amount >= 0),
  preferred_payment_method text NOT NULL DEFAULT 'spei_transfer' CHECK (preferred_payment_method IN ('spei_transfer', 'international_transfer', 'check', 'cash', 'other')),
  bank_account_holder_name text,
  bank_name text,
  bank_account_number text,
  bank_clabe text,
  bank_swift_code text,
  payment_currency text NOT NULL DEFAULT 'MXN' CHECK (payment_currency IN ('MXN', 'USD', 'EUR')),
  automatic_payout_enabled boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
)
;



-- Create integration_configs table
CREATE TABLE IF NOT EXISTS integration_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (provider IN ('zoho_books', 'odoo', 'quickbooks', 'bank_api', 'stripe_connect', 'custom')),
  agency_id uuid REFERENCES agencies(id) ON DELETE CASCADE,
  is_active boolean NOT NULL DEFAULT false,
  credentials text,
  api_endpoint text,
  sync_frequency text NOT NULL DEFAULT 'manual' CHECK (sync_frequency IN ('manual', 'daily', 'weekly', 'real_time')),
  last_sync_at timestamptz,
  last_sync_status text CHECK (last_sync_status IN ('success', 'failed', 'pending')),
  error_log jsonb,
  configuration jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
)
;



-- Create indexes
CREATE INDEX IF NOT EXISTS idx_payout_schedules_agency_id ON payout_schedules(agency_id)
;


CREATE INDEX IF NOT EXISTS idx_payout_schedules_frequency ON payout_schedules(frequency)
;


CREATE INDEX IF NOT EXISTS idx_integration_configs_provider ON integration_configs(provider)
;


CREATE INDEX IF NOT EXISTS idx_integration_configs_agency_id ON integration_configs(agency_id)
;


CREATE INDEX IF NOT EXISTS idx_integration_configs_is_active ON integration_configs(is_active)
;



-- Enable RLS
ALTER TABLE payout_schedules ENABLE ROW LEVEL SECURITY
;


ALTER TABLE integration_configs ENABLE ROW LEVEL SECURITY
;



-- Policies for payout_schedules
CREATE POLICY "Agencies can view own schedule"
  ON payout_schedules
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM agencies
      WHERE agencies.id = payout_schedules.agency_id
      AND agencies.user_id = auth.uid()
    )
  )
;



CREATE POLICY "Agencies can update own schedule"
  ON payout_schedules
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM agencies
      WHERE agencies.id = payout_schedules.agency_id
      AND agencies.user_id = auth.uid()
    )
  )
;



CREATE POLICY "Agencies can insert own schedule"
  ON payout_schedules
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM agencies
      WHERE agencies.id = payout_schedules.agency_id
      AND agencies.user_id = auth.uid()
    )
  )
;



CREATE POLICY "Admins can view all schedules"
  ON payout_schedules
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'super_admin')
    )
  )
;



CREATE POLICY "Admins can manage all schedules"
  ON payout_schedules
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'super_admin')
    )
  )
;



-- Policies for integration_configs
CREATE POLICY "Admins can view all integration configs"
  ON integration_configs
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'super_admin')
    )
  )
;



CREATE POLICY "Admins can manage integration configs"
  ON integration_configs
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'super_admin')
    )
  )
;



-- Create update triggers
CREATE OR REPLACE FUNCTION update_payout_schedules_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now()
;


  RETURN NEW
;


END
;


$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
;



DROP TRIGGER IF EXISTS update_payout_schedules_updated_at_trigger ON payout_schedules
;


CREATE TRIGGER update_payout_schedules_updated_at_trigger
  BEFORE UPDATE ON payout_schedules
  FOR EACH ROW
  EXECUTE FUNCTION update_payout_schedules_updated_at()
;



CREATE OR REPLACE FUNCTION update_integration_configs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now()
;


  RETURN NEW
;


END
;


$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
;



DROP TRIGGER IF EXISTS update_integration_configs_updated_at_trigger ON integration_configs
;


CREATE TRIGGER update_integration_configs_updated_at_trigger
  BEFORE UPDATE ON integration_configs
  FOR EACH ROW
  EXECUTE FUNCTION update_integration_configs_updated_at()
;
