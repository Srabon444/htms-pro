import { rolloverIncomplete } from '$lib/workplan/rollover';
import type { Actions, PageServerLoad } from './$types';

function currentWeekStart(): string {
	const now = new Date();
	const day = now.getUTCDay();
	const diff = (day === 0 ? -6 : 1) - day;
	now.setUTCDate(now.getUTCDate() + diff);
	return now.toISOString().slice(0, 10);
}

export const load: PageServerLoad = async ({ locals, url }) => {
	const weekStart = url.searchParams.get('week') ?? currentWeekStart();
	const { data: items } = await locals.supabase
		.from('hrms_work_plan_items')
		.select('id, description, target_value, owner, status')
		.eq('week_start', weekStart);
	return { weekStart, items: items ?? [] };
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const form = await request.formData();
		await locals.supabase.from('hrms_work_plan_items').insert({
			description: String(form.get('description')),
			target_value: String(form.get('target_value') ?? '') || null,
			owner: String(form.get('owner') ?? '') || null,
			week_start: String(form.get('week_start'))
		});
	},
	updateStatus: async ({ request, locals }) => {
		const form = await request.formData();
		await locals.supabase
			.from('hrms_work_plan_items')
			.update({ status: String(form.get('status')) })
			.eq('id', String(form.get('id')));
	},
	startNewWeek: async ({ request, locals }) => {
		const form = await request.formData();
		const currentWeek = String(form.get('current_week'));
		const nextWeek = String(form.get('next_week'));

		const { data: items } = await locals.supabase
			.from('hrms_work_plan_items')
			.select('id, description, target_value, owner, status')
			.eq('week_start', currentWeek);

		const rolled = rolloverIncomplete(items ?? [], nextWeek);
		if (rolled.length > 0) {
			await locals.supabase.from('hrms_work_plan_items').insert(rolled);
		}
	}
};
