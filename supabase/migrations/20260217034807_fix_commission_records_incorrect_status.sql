
UPDATE commission_records
SET status = 'pending'
WHERE status = 'processed'
AND processed_at IS NULL;
