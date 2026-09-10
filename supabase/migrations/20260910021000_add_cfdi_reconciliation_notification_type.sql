-- El reconciliador de CFDI notifica usando este tipo; faltaba en el enum
-- historico y hacia que la funcion de deteccion fallara al validarse.
ALTER TYPE public.notification_type
  ADD VALUE IF NOT EXISTS 'cfdi_reconciliation_alert';

