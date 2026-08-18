import { error } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	const { data: employee } = await locals.supabase
		.from('hrms_employees')
		.select('*, hrms_departments(name), hrms_positions(title)')
		.eq('id', params.id)
		.single();
	if (!employee) throw error(404, 'Employee not found');

	const { data: documents } = await locals.supabase
		.from('hrms_employee_documents')
		.select('id, file_path, label, uploaded_at')
		.eq('employee_id', params.id)
		.order('uploaded_at', { ascending: false });

	return { employee, documents: documents ?? [] };
};

export const actions: Actions = {
	updateStatus: async ({ request, params, locals }) => {
		const form = await request.formData();
		await locals.supabase
			.from('hrms_employees')
			.update({ status: String(form.get('status')) })
			.eq('id', params.id);
	},
	uploadDocument: async ({ request, params, locals }) => {
		const form = await request.formData();
		const file = form.get('file') as File;
		const label = String(form.get('label'));
		const path = `${params.id}/${Date.now()}_${file.name}`;

		await locals.supabase.storage.from('hrms-employee-documents').upload(path, file);
		await locals.supabase
			.from('hrms_employee_documents')
			.insert({ employee_id: params.id, file_path: path, label });
	}
};
