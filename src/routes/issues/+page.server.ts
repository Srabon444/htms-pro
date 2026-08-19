import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const { data: issues } = await locals.supabase
		.from('hrms_issues_log')
		.select('id, issue, solution, status, owner, created_at')
		.order('created_at', { ascending: false });
	return { issues: issues ?? [] };
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const form = await request.formData();
		await locals.supabase.from('hrms_issues_log').insert({
			issue: String(form.get('issue')),
			solution: String(form.get('solution') ?? '') || null,
			owner: String(form.get('owner') ?? '') || null
		});
	},
	resolve: async ({ request, locals }) => {
		const form = await request.formData();
		await locals.supabase
			.from('hrms_issues_log')
			.update({ status: 'resolved', resolved_at: new Date().toISOString() })
			.eq('id', String(form.get('id')));
	}
};
