/*
# Fix profile-pictures DELETE and UPDATE policies — correct UUID extraction

## Problem
The policies images_delete_profile_pictures and images_update_profile_pictures
used (storage.foldername(name))[2] to extract the user ID from the filename.
However, storage.foldername() only returns folder segments, NOT the filename
itself. For files like "profile-pictures/{userId}-{timestamp}.ext", there is
only one folder segment ("profile-pictures"), so [2] is always NULL — blocking
every user including the legitimate owner.

Additionally, even if the filename were reached, splitting by the first hyphen
would only capture the first segment of a UUID (e.g. "a1b2c3d4" from
"a1b2c3d4-e5f6-7890-abcd-ef1234567890"), since UUIDs contain internal hyphens.

## Fix
Replace the extraction logic with:
1. split_part(name, '/', 2) — gets everything after "profile-pictures/"
2. substring(... FROM 1 FOR 36) — takes exactly the first 36 characters
   (the fixed length of a hyphenated UUID), yielding the complete user ID
3. Compare against auth.uid()::text

## Verification
Tested with a sample filename before applying:
  Input:  profile-pictures/a1b2c3d4-e5f6-7890-abcd-ef1234567890-1699000000000.jpg
  Extracted: a1b2c3d4-e5f6-7890-abcd-ef1234567890  (full UUID, matches expected)

## What is NOT changed
- SELECT policy (public read) — untouched
- All other images bucket policies (tours/agencies, destinations, newsletter) — untouched
*/

DROP POLICY IF EXISTS "images_delete_profile_pictures" ON storage.objects;
DROP POLICY IF EXISTS "images_update_profile_pictures" ON storage.objects;

CREATE POLICY "images_delete_profile_pictures"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'images'
  AND (storage.foldername(name))[1] = 'profile-pictures'
  AND substring(split_part(name, '/', 2) FROM 1 FOR 36) = auth.uid()::text
);

CREATE POLICY "images_update_profile_pictures"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'images'
  AND (storage.foldername(name))[1] = 'profile-pictures'
  AND substring(split_part(name, '/', 2) FROM 1 FOR 36) = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'images'
  AND (storage.foldername(name))[1] = 'profile-pictures'
  AND substring(split_part(name, '/', 2) FROM 1 FOR 36) = auth.uid()::text
);