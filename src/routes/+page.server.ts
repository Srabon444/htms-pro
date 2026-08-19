import { summarizeAttendance } from '$lib/report/attendanceSummary';
import { computeFunnel } from '$lib/report/funnel';
import { parseFilters } from '$lib/filters/urlFilters';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const filters = parseFilters(url.searchParams);
	const from = filters.from ?? new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
	const to = filters.to ?? new Date().toISOString().slice(0, 10);

	let attendanceQuery = locals.supabase
		.from('hrms_attendance_daily')
		.select('employee_id, status, hours_worked, missed_hours_reason, hrms_employees!inner(department_id)')
		.gte('work_date', from)
		.lte('work_date', to);
	if (filters.departmentId) {
		attendanceQuery = attendanceQuery.eq('hrms_employees.department_id', filters.departmentId);
	}
	const { data: attendanceRows } = await attendanceQuery;
	const attendanceSummary = summarizeAttendance(attendanceRows ?? []);

	const { data: openings } = await locals.supabase
		.from('hrms_job_openings')
		.select('id, title, hrms_pipeline_stages(id, name, sort_order), hrms_candidates(id, current_stage_id)');
	const funnels = (openings ?? []).map((o) => ({
		title: o.title,
		funnel: computeFunnel(o.hrms_pipeline_stages, o.hrms_candidates)
	}));

	const { data: newHires } = await locals.supabase
		.from('hrms_new_hires')
		.select('position_title, start_date')
		.gte('start_date', from)
		.lte('start_date', to);

	//! created_at is timestamptz; a bare date string upper bound casts to that day's midnight
	//! and silently excludes same-day rows created after 00:00 UTC — extend to end of day.
	const { data: issues } = await locals.supabase
		.from('hrms_issues_log')
		.select('issue, solution, status, owner')
		.gte('created_at', from)
		.lte('created_at', `${to}T23:59:59.999Z`);

	const { data: workPlanItems } = await locals.supabase
		.from('hrms_work_plan_items')
		.select('description, target_value, owner, status')
		.gte('week_start', from)
		.lte('week_start', to);

	const { data: departments } = await locals.supabase.from('hrms_departments').select('id, name').order('name');

	return {
		filters: { from, to, departmentId: filters.departmentId },
		departments: departments ?? [],
		attendanceSummary,
		funnels,
		newHires: newHires ?? [],
		issues: issues ?? [],
		workPlanItems: workPlanItems ?? []
	};
};
