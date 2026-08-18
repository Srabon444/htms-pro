-- Run this manually in the Supabase SQL Editor (project rshmotzxcdwqxkocimqf).
-- Grants authenticated users full access to ONLY the hrms-employee-documents bucket.
-- Scoped by bucket_id, so it does not affect any other bucket's existing policies.
drop policy if exists "hrms_employee_documents_authenticated_all" on storage.objects;
create policy "hrms_employee_documents_authenticated_all"
on storage.objects for all
to authenticated
using (bucket_id = 'hrms-employee-documents')
with check (bucket_id = 'hrms-employee-documents');
