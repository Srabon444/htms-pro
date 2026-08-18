import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const { data: departments } = await locals.supabase
		.from('hrms_departments')
		.select('id, name')
		.order('name');
	return { departments: departments ?? [] };
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const form = await request.formData();
		const name = String(form.get('name'));
		await locals.supabase.from('hrms_departments').insert({ name });
	},
	delete: async ({ request, locals }) => {
		const form = await request.formData();
		const id = String(form.get('id'));
		await locals.supabase.from('hrms_departments').delete().eq('id', id);
	}
};
