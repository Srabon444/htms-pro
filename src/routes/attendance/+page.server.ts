import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const date = url.searchParams.get('date') ?? new Date().toISOString().slice(0, 10);

	const [{ data: employees }, { data: records }] = await Promise.all([
		locals.supabase.from('hrms_employees').select('id, full_name').eq('status', 'active').order('full_name'),
		locals.supabase.from('hrms_attendance_daily').select('*').eq('work_date', date)
	]);

	return { date, employees: employees ?? [], records: records ?? [] };
};

export const actions: Actions = {
	mark: async ({ request, locals }) => {
		const form = await request.formData();
		await locals.supabase.from('hrms_attendance_daily').upsert(
			{
				employee_id: String(form.get('employee_id')),
				work_date: String(form.get('work_date')),
				status: String(form.get('status')),
				hours_worked: form.get('hours_worked') ? Number(form.get('hours_worked')) : null,
				missed_hours_reason: String(form.get('missed_hours_reason') ?? '') || null
			},
			{ onConflict: 'employee_id,work_date' }
		);
	}
};
