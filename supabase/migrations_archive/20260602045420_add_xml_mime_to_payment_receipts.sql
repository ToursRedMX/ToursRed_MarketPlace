
UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  'image/jpeg',
  'image/png',
  'image/jpg',
  'application/pdf',
  'text/xml',
  'application/xml'
]
WHERE id = 'payment-receipts';
