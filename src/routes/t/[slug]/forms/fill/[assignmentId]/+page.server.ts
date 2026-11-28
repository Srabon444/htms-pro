import { error, fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { AppError } from '#lib/server/errors.ts';
import { fillPage, submitForm } from '#lib/server/forms.ts';
import { actionError } from '#lib/server/http/forms.ts';
import { requireModule } from '#lib/server/modules.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const m = await requireModule(locals, 'forms');
	try {
		return { fill: await fillPage(m, params.assignmentId) };
	} catch (err) {
		if (err instanceof AppError) error(err.status, err.message);
		throw err;
	}
};

export const actions: Actions = {
	submit: async ({ request, locals, params }) => {
		const m = await requireModule(locals, 'forms');
		try {
			await submitForm(m, params.assignmentId, await request.formData());
		} catch (err) {
			if (err instanceof z.ZodError) return fail(400, { message: err.issues[0].message });
			return actionError(err, locals.requestId);
		}
		redirect(303, `/t/${m.tenant.slug}/forms?sent=1`);
	}
};
