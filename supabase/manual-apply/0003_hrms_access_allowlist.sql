-- Run this manually in the Supabase SQL Editor (project rshmotzxcdwqxkocimqf).
-- Replaces 0001's blanket `using (true)` policies and 0002's bucket-only storage policy with an
-- explicit allowlist.
--
--? This project is shared with the meal and timesheet apps, so `authenticated` does not mean
--? "HR staff", it means "holds any account here" — and signup is about to be opened.
--! hrms_employees has no auth_user_id / email column, so "see only your own row" is not
--! expressible. The allowlist is the gate instead.

create table if not exists hrms_access (
	auth_user_id uuid primary key references auth.users(id) on delete cascade,
	note text,
	created_at timestamptz not null default now()
);

alter table hrms_access enable row level security;

--! No `authenticated` policy on purpose — RLS on with zero policies makes the table unreadable
--! to the app; the allowlist is managed from the dashboard (postgres/service_role bypasses RLS).

create or replace function hrms_has_access()
returns boolean
language sql stable security definer set search_path = public
as $$
	select exists (select 1 from hrms_access where auth_user_id = auth.uid());
$$;

grant execute on function public.hrms_has_access() to authenticated, service_role;

--! EDIT THIS LIST BEFORE RUNNING — anyone not listed loses hrms access once the policies below
--! are swapped in. Not seeded from all of auth.users: that would reopen the hole this closes.
insert into hrms_access (auth_user_id, note)
select u.id, 'initial seed'
from auth.users u
where u.email in ('srabon444@gmail.com')
on conflict (auth_user_id) do nothing;

--! Guard and both policy swaps share ONE do-block: a do-block is a single statement, so on an
--! empty allowlist the exception fires having swapped nothing and hrms keeps working. Split
--! across statements, a bad email list would lock everyone out.
do $$
declare
	t text;
begin
	if not exists (select 1 from hrms_access) then
		raise exception 'hrms_access is empty: the seed above matched no auth.users row. '
			'Check the email list against auth.users.email, then re-run. '
			'Nothing was changed, hrms still works.';
	end if;

	for t in select unnest(array[
		'hrms_departments','hrms_positions','hrms_employees','hrms_employee_documents','hrms_attendance_daily',
		'hrms_job_openings','hrms_pipeline_stages','hrms_candidates','hrms_candidate_stage_history',
		'hrms_new_hires','hrms_issues_log','hrms_work_plan_items'
	])
	loop
		execute format('alter table %I enable row level security', t);
		--* both names dropped so this file is safe to re-run: the 0001 policy and this one
		execute format('drop policy if exists %I on %I', t || '_authenticated_all', t);
		execute format('drop policy if exists %I on %I', t || '_allowlisted_all', t);
		execute format(
			'create policy %I on %I for all to authenticated '
			'using (public.hrms_has_access()) with check (public.hrms_has_access())',
			t || '_allowlisted_all', t
		);
	end loop;

	--* Same gate on the document bucket — 0002 scoped it by bucket_id only, which let any
	--* authenticated user read, overwrite and delete employee documents.
	execute 'drop policy if exists "hrms_employee_documents_authenticated_all" on storage.objects';
	execute 'drop policy if exists "hrms_employee_documents_allowlisted_all" on storage.objects';
	execute 'create policy "hrms_employee_documents_allowlisted_all" on storage.objects '
		'for all to authenticated '
		'using (bucket_id = ''hrms-employee-documents'' and public.hrms_has_access()) '
		'with check (bucket_id = ''hrms-employee-documents'' and public.hrms_has_access())';
end $$;
