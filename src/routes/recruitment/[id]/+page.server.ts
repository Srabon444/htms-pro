import { error } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	const { data: opening } = await locals.supabase
		.from('hrms_job_openings')
		.select('id, title, target_headcount, status')
		.eq('id', params.id)
		.single();
	if (!opening) throw error(404, 'Job opening not found');

	const [{ data: stages }, { data: candidates }] = await Promise.all([
		locals.supabase
			.from('hrms_pipeline_stages')
			.select('id, name, sort_order')
			.eq('job_opening_id', params.id)
			.order('sort_order'),
		locals.supabase
			.from('hrms_candidates')
			.select('id, name, source, current_stage_id')
			.eq('job_opening_id', params.id)
	]);

	return { opening, stages: stages ?? [], candidates: candidates ?? [] };
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
	},
	addCandidate: async ({ request, params, locals }) => {
		const form = await request.formData();
		await locals.supabase.from('hrms_candidates').insert({
			job_opening_id: params.id,
			name: String(form.get('name')),
			source: String(form.get('source')),
			current_stage_id: String(form.get('stage_id'))
		});
	},
	moveCandidate: async ({ request, locals }) => {
		const form = await request.formData();
		const candidateId = String(form.get('candidate_id'));
		const stageId = String(form.get('stage_id'));

		await locals.supabase.from('hrms_candidates').update({ current_stage_id: stageId }).eq('id', candidateId);
		await locals.supabase
			.from('hrms_candidate_stage_history')
			.insert({ candidate_id: candidateId, stage_id: stageId });
	},
	convertToHire: async ({ request, params, locals }) => {
		const form = await request.formData();
		const candidateId = String(form.get('candidate_id'));
		const startDate = String(form.get('start_date'));

		const { data: candidate } = await locals.supabase
			.from('hrms_candidates')
			.select('name')
			.eq('id', candidateId)
			.single();
		const { data: opening } = await locals.supabase
			.from('hrms_job_openings')
			.select('title')
			.eq('id', params.id)
			.single();
		if (!candidate || !opening) return;

		const { data: employee } = await locals.supabase
			.from('hrms_employees')
			.insert({
				full_name: candidate.name,
				employment_type: 'full_time',
				join_date: startDate
			})
			.select('id')
			.single();

		await locals.supabase.from('hrms_new_hires').insert({
			candidate_id: candidateId,
			employee_id: employee?.id ?? null,
			position_title: opening.title,
			start_date: startDate
		});
	}
};
