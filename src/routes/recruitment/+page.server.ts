import type { Actions, PageServerLoad } from './$types';

const DEFAULT_STAGES = [
	'Application review',
	'Screening call',
	'1st Interview',
	'Tech Assessment',
	'Second Interview',
	'Reference Check',
	'Reserved',
	'Offer'
];

export const load: PageServerLoad = async ({ locals }) => {
	const { data: openings } = await locals.supabase
		.from('hrms_job_openings')
		.select('id, title, target_headcount, status')
		.order('created_at', { ascending: false });
	return { openings: openings ?? [] };
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const form = await request.formData();
		const { data: opening } = await locals.supabase
			.from('hrms_job_openings')
			.insert({
				title: String(form.get('title')),
				target_headcount: Number(form.get('target_headcount'))
			})
			.select('id')
			.single();

		if (opening) {
			await locals.supabase.from('hrms_pipeline_stages').insert(
				DEFAULT_STAGES.map((name, i) => ({ job_opening_id: opening.id, name, sort_order: i }))
			);
		}
	}
};
