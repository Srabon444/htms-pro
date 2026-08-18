import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const [{ data: employees }, { data: departments }, { data: positions }] = await Promise.all([
		locals.supabase
			.from('hrms_employees')
			.select('id, full_name, status, join_date, hrms_departments(name), hrms_positions(title)')
			.order('full_name'),
		locals.supabase.from('hrms_departments').select('id, name').order('name'),
		locals.supabase.from('hrms_positions').select('id, title').order('title')
	]);
	return {
		employees: employees ?? [],
		departments: departments ?? [],
		positions: positions ?? []
	};
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const form = await request.formData();
		await locals.supabase.from('hrms_employees').insert({
			full_name: String(form.get('full_name')),
			department_id: String(form.get('department_id')) || null,
			position_id: String(form.get('position_id')) || null,
			employment_type: String(form.get('employment_type')),
			join_date: String(form.get('join_date')),
			emergency_contact_name: String(form.get('emergency_contact_name') ?? '') || null,
			emergency_contact_phone: String(form.get('emergency_contact_phone') ?? '') || null
		});
	}
};
