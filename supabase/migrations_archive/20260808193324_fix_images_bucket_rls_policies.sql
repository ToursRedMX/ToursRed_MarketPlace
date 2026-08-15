/*
# Fix Storage "images" bucket DELETE and UPDATE RLS policies

## Problem
The current DELETE and UPDATE policies on the storage.objects table for the
"images" bucket allow ANY authenticated user to delete or overwrite ANY file
in the bucket, with no ownership or role verification whatsoever.

## What this migration does
Replaces the two overly-permissive policies with six granular policies that
cover three distinct ownership/permission patterns:

### PART 1 — profile-pictures/ (ownership by user ID embedded in filename)
- DELETE: only if filename starts with the caller's auth.uid() before the first hyphen
- UPDATE: same check

### PART 2 — tours/ and agencies/ (ownership by agency_id in folder path)
- DELETE: only if the folder segment after "tours/" or "agencies/" matches an
  agency_id the caller owns (same pattern as agency-documents bucket)
- UPDATE: same check

### PART 3 — destinations/ and newsletter- (role-based, not individual ownership)
- destinations/: DELETE and UPDATE allowed for admin, super_admin, or agency roles
  (collaborative content, any agency can edit; travelers cannot)
- newsletter- prefix: DELETE and UPDATE restricted to admin/super_admin only

## What is NOT changed
- The SELECT policy "Allow public read access to images" is untouched — public
  read access remains exactly as-is.
- The INSERT policy "Allow authenticated users to upload images" is untouched.
- No existing files are migrated. Files uploaded with the old format (without
  agency_id in the path for tours/ and agencies/) will remain undeletable by
  non-admin users until they are re-upplied with the new format.

## Policies dropped
1. "Allow users to delete their own images" (DELETE — was bucket-wide, no checks)
2. "Allow users to update their own images" (UPDATE — was bucket-wide, no checks)

## Policies created (6)
1. images_delete_profile_pictures — DELETE for profile-pictures/ prefix, owner by auth.uid()
2. images_update_profile_pictures — UPDATE for profile-pictures/ prefix, owner by auth.uid()
3. images_delete_tours_agencies — DELETE for tours/ and agencies/ prefixes, owner by agency_id in path
4. images_update_tours_agencies — UPDATE for tours/ and agencies/ prefixes, owner by agency_id in path
5. images_delete_destinations — DELETE for destinations/ prefix, admin/super_admin/agency role
6. images_delete_newsletter — DELETE for newsletter- prefix, admin/super_admin role only
7. images_update_destinations — UPDATE for destinations/ prefix, admin/super_admin/agency role
8. images_update_newsletter — UPDATE for newsletter- prefix, admin/super_admin role only
*/

-- Drop the two overly-permissive policies
DROP POLICY IF EXISTS "Allow users to delete their own images" ON storage.objects;
DROP POLICY IF EXISTS "Allow users to update their own images" ON storage.objects;

-- ============================================================================
-- PART 1: profile-pictures/ — ownership by auth.uid() at start of filename
-- File format: profile-pictures/{userId}-{timestamp}.ext
-- ============================================================================

CREATE POLICY "images_delete_profile_pictures"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'images'
  AND (storage.foldername(name))[1] = 'profile-pictures'
  AND split_part((storage.foldername(name))[2], '-', 1) = auth.uid()::text
);

CREATE POLICY "images_update_profile_pictures"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'images'
  AND (storage.foldername(name))[1] = 'profile-pictures'
  AND split_part((storage.foldername(name))[2], '-', 1) = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'images'
  AND (storage.foldername(name))[1] = 'profile-pictures'
  AND split_part((storage.foldername(name))[2], '-', 1) = auth.uid()::text
);

-- ============================================================================
-- PART 2: tours/ and agencies/ — ownership by agency_id in folder path
-- File format: tours/{agency_id}/{timestamp}-{random}.ext
--              agencies/{agency_id}/{timestamp}-{random}.ext
-- Pattern follows the existing agency-documents bucket approach.
-- ============================================================================

CREATE POLICY "images_delete_tours_agencies"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'images'
  AND (storage.foldername(name))[1] IN ('tours', 'agencies')
  AND (storage.foldername(name))[2] IN (
    SELECT agencies.id::text
    FROM agencies
    WHERE agencies.user_id = auth.uid()
  )
);

CREATE POLICY "images_update_tours_agencies"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'images'
  AND (storage.foldername(name))[1] IN ('tours', 'agencies')
  AND (storage.foldername(name))[2] IN (
    SELECT agencies.id::text
    FROM agencies
    WHERE agencies.user_id = auth.uid()
  )
)
WITH CHECK (
  bucket_id = 'images'
  AND (storage.foldername(name))[1] IN ('tours', 'agencies')
  AND (storage.foldername(name))[2] IN (
    SELECT agencies.id::text
    FROM agencies
    WHERE agencies.user_id = auth.uid()
  )
);

-- ============================================================================
-- PART 3a: destinations/ — collaborative content, role-based (admin/super_admin/agency)
-- File format: destinations/{timestamp}-{random}.ext
-- ============================================================================

CREATE POLICY "images_delete_destinations"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'images'
  AND (storage.foldername(name))[1] = 'destinations'
  AND EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.role IN ('admin', 'super_admin', 'agency')
  )
);

CREATE POLICY "images_update_destinations"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'images'
  AND (storage.foldername(name))[1] = 'destinations'
  AND EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.role IN ('admin', 'super_admin', 'agency')
  )
)
WITH CHECK (
  bucket_id = 'images'
  AND (storage.foldername(name))[1] = 'destinations'
  AND EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.role IN ('admin', 'super_admin', 'agency')
  )
);

-- ============================================================================
-- PART 3b: newsletter- prefix — admin/super_admin only
-- File format: newsletter-{timestamp}-{random}.ext (no folder, root level)
-- ============================================================================

CREATE POLICY "images_delete_newsletter"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'images'
  AND name LIKE 'newsletter-%'
  AND EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.role IN ('admin', 'super_admin')
  )
);

CREATE POLICY "images_update_newsletter"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'images'
  AND name LIKE 'newsletter-%'
  AND EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.role IN ('admin', 'super_admin')
  )
)
WITH CHECK (
  bucket_id = 'images'
  AND name LIKE 'newsletter-%'
  AND EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.role IN ('admin', 'super_admin')
  )
);