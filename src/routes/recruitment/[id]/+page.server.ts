import { error } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	const { data: opening } = await locals.supabase
		.from('hrms_job_openings')
		.select('id, title, target_headcount, status')
		.eq('id', params.id)
		.single();
	if (!opening) throw error(404, 'Job opening not found');

	const { data: stages } = await locals.supabase
		.from('hrms_pipeline_stages')
		.select('id, name, sort_order')
		.eq('job_opening_id', params.id)
		.order('sort_order');

	return { opening, stages: stages ?? [] };
};

export const actions: Actions = {
	addStage: async ({ request, params, locals }) => {
		const form = await request.formData();
		const { data: existing } = await locals.supabase
			.from('hrms_pipeline_stages')
			.select('sort_order')
			.eq('job_opening_id', params.id)
			.order('sort_order', { ascending: false })
			.limit(1);
		const nextOrder = (existing?.[0]?.sort_order ?? -1) + 1;

		await locals.supabase
			.from('hrms_pipeline_stages')
			.insert({ job_opening_id: params.id, name: String(form.get('name')), sort_order: nextOrder });
	},
	renameStage: async ({ request, locals }) => {
		const form = await request.formData();
		await locals.supabase
			.from('hrms_pipeline_stages')
			.update({ name: String(form.get('name')) })
			.eq('id', String(form.get('stage_id')));
	}
};
