create extension if not exists "pgcrypto";

create table hrms_departments (
	id uuid primary key default gen_random_uuid(),
	name text not null unique,
	created_at timestamptz not null default now()
);

create table hrms_positions (
	id uuid primary key default gen_random_uuid(),
	title text not null,
	department_id uuid references hrms_departments(id) on delete set null,
	created_at timestamptz not null default now()
);

create table hrms_employees (
	id uuid primary key default gen_random_uuid(),
	full_name text not null,
	department_id uuid references hrms_departments(id) on delete set null,
	position_id uuid references hrms_positions(id) on delete set null,
	employment_type text not null check (employment_type in ('full_time','part_time','intern','contract')),
	status text not null default 'active' check (status in ('active','resigned','terminated')),
	join_date date not null,
	emergency_contact_name text,
	emergency_contact_phone text,
	created_at timestamptz not null default now()
);

create table hrms_employee_documents (
	id uuid primary key default gen_random_uuid(),
	employee_id uuid not null references hrms_employees(id) on delete cascade,
	file_path text not null,
	label text not null,
	uploaded_at timestamptz not null default now()
);

create table hrms_attendance_daily (
	id uuid primary key default gen_random_uuid(),
	employee_id uuid not null references hrms_employees(id) on delete cascade,
	work_date date not null,
	status text not null check (status in ('present','late','absent','mc','leave')),
	hours_worked numeric(4,2),
	missed_hours_reason text,
	unique (employee_id, work_date)
);

create table hrms_job_openings (
	id uuid primary key default gen_random_uuid(),
	title text not null,
	target_headcount int not null default 1,
	status text not null default 'open' check (status in ('open','closed')),
	created_at timestamptz not null default now()
);

create table hrms_pipeline_stages (
	id uuid primary key default gen_random_uuid(),
	job_opening_id uuid not null references hrms_job_openings(id) on delete cascade,
	name text not null,
	sort_order int not null
);

create table hrms_candidates (
	id uuid primary key default gen_random_uuid(),
	job_opening_id uuid not null references hrms_job_openings(id) on delete cascade,
	name text not null,
	source text check (source in ('application','linkedin_headhunt','referral','other')),
	current_stage_id uuid references hrms_pipeline_stages(id) on delete set null,
	created_at timestamptz not null default now()
);

create table hrms_candidate_stage_history (
	id uuid primary key default gen_random_uuid(),
	candidate_id uuid not null references hrms_candidates(id) on delete cascade,
	stage_id uuid not null references hrms_pipeline_stages(id) on delete cascade,
	moved_at timestamptz not null default now()
);

create table hrms_new_hires (
	id uuid primary key default gen_random_uuid(),
	candidate_id uuid references hrms_candidates(id) on delete set null,
	employee_id uuid references hrms_employees(id) on delete set null,
	position_title text not null,
	start_date date not null,
	created_at timestamptz not null default now()
);

create table hrms_issues_log (
	id uuid primary key default gen_random_uuid(),
	issue text not null,
	solution text,
	status text not null default 'open' check (status in ('open','resolved')),
	owner text,
	created_at timestamptz not null default now(),
	resolved_at timestamptz
);

create table hrms_work_plan_items (
	id uuid primary key default gen_random_uuid(),
	description text not null,
	target_value text,
	owner text,
	status text not null default 'pending' check (status in ('pending','in_progress','done')),
	week_start date not null,
	carried_over_from uuid references hrms_work_plan_items(id) on delete set null,
	created_at timestamptz not null default now()
);

-- RLS: single-tenant, single role — authenticated users get full access, anon gets none.
do $$
declare
	t text;
begin
	for t in select unnest(array[
		'hrms_departments','hrms_positions','hrms_employees','hrms_employee_documents','hrms_attendance_daily',
		'hrms_job_openings','hrms_pipeline_stages','hrms_candidates','hrms_candidate_stage_history',
		'hrms_new_hires','hrms_issues_log','hrms_work_plan_items'
	])
	loop
		execute format('alter table %I enable row level security', t);
		execute format(
			'create policy %I on %I for all to authenticated using (true) with check (true)',
			t || '_authenticated_all', t
		);
	end loop;
end $$;
