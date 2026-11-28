import { redirect } from '@sveltejs/kit';
import { createForm, formsPage } from '#lib/server/forms.ts';
import { employeeActionError as failed, formFields } from '#lib/server/http/employee-form.ts';
import { requireModule } from '#lib/server/modules.ts';
import { userCtx } from '#lib/server/rbac/access.ts';
import { withTenant } from '#lib/server/tenancy/index.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const m = await requireModule(locals, 'forms');
	return { page: await withTenant(userCtx(m), (tx) => formsPage(tx, m)), sent: url.searchParams.has('sent') };
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const m = await requireModule(locals, 'forms', 'form.manage');
		const form = formFields(await request.formData());
		let id: string;
		try {
			id = await createForm(m, form);
		} catch (err) {
			return failed(err, locals.requestId, form);
		}
		redirect(303, `/t/${m.tenant.slug}/forms/${id}`);
	}
};
