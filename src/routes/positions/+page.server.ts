import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const [{ data: positions }, { data: departments }] = await Promise.all([
		locals.supabase
			.from('hrms_positions')
			.select('id, title, department_id, hrms_departments(name)')
			.order('title'),
		locals.supabase.from('hrms_departments').select('id, name').order('name')
	]);
	return { positions: positions ?? [], departments: departments ?? [] };
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const form = await request.formData();
		await locals.supabase.from('hrms_positions').insert({
			title: String(form.get('title')),
			department_id: String(form.get('department_id')) || null
		});
	},
	delete: async ({ request, locals }) => {
		const form = await request.formData();
		await locals.supabase.from('hrms_positions').delete().eq('id', String(form.get('id')));
	}
};
