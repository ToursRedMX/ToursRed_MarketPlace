-- Add can_view_seguros to default permissions for new invitations
ALTER TABLE accounting_access_invitations
  ALTER COLUMN permissions SET DEFAULT 
    '{"can_view_accounting": true, "can_export_sat_xml": true, "can_manage_chart_of_accounts": false, "can_view_seguros": false}'::jsonb;

-- Backfill existing records that don't have the key yet
UPDATE accounting_access_invitations
SET permissions = permissions || '{"can_view_seguros": false}'::jsonb
WHERE NOT (permissions ? 'can_view_seguros');
