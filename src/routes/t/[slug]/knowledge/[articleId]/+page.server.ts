import { error, redirect } from '@sveltejs/kit';
import { articlePage, deleteArticle, saveArticle } from '#lib/server/knowledge.ts';
import { employeeActionError as failed, formFields } from '#lib/server/http/employee-form.ts';
import { requireModule } from '#lib/server/modules.ts';
import { userCtx } from '#lib/server/rbac/access.ts';
import { withTenant } from '#lib/server/tenancy/index.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, url }) => {
	const m = await requireModule(locals, 'knowledge');
	const page = await withTenant(userCtx(m), (tx) => articlePage(tx, m.access, params.articleId));
	if (!page) error(404, 'That article does not exist.');
	return { ...page, editing: page.manager && url.searchParams.has('edit') };
};

export const actions: Actions = {
	save: async ({ request, locals, params }) => {
		const m = await requireModule(locals, 'knowledge');
		const form = formFields(await request.formData());
		try {
			await saveArticle(m, { ...form, articleId: params.articleId });
		} catch (err) {
			return failed(err, locals.requestId, form);
		}
		redirect(303, `/t/${m.tenant.slug}/knowledge/${params.articleId}`);
	},
	remove: async ({ locals, params }) => {
		const m = await requireModule(locals, 'knowledge');
		let folder: string | null;
		try {
			folder = await deleteArticle(m, { articleId: params.articleId });
		} catch (err) {
			return failed(err, locals.requestId, {});
		}
		redirect(303, `/t/${m.tenant.slug}/knowledge${folder ? `?folder=${folder}` : ''}`);
	}
};
