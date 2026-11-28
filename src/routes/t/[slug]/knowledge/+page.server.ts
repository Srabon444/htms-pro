import { error, redirect } from '@sveltejs/kit';
import { deleteFolder, knowledgePage, saveArticle, saveFolder } from '#lib/server/knowledge.ts';
import { employeeActionError as failed, formFields } from '#lib/server/http/employee-form.ts';
import { requireModule } from '#lib/server/modules.ts';
import { userCtx } from '#lib/server/rbac/access.ts';
import { withTenant } from '#lib/server/tenancy/index.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const m = await requireModule(locals, 'knowledge');
	const page = await withTenant(userCtx(m), (tx) =>
		knowledgePage(tx, m.access, { folder: url.searchParams.get('folder'), q: url.searchParams.get('q') })
	);
	if (!page) error(404, 'That folder does not exist.');
	return { ...page, grid: url.searchParams.get('view') === 'grid' };
};

const here = (slug: string, folder: string | null) => `/t/${slug}/knowledge${folder ? `?folder=${folder}` : ''}`;

export const actions: Actions = {
	folder: async ({ request, locals }) => {
		const m = await requireModule(locals, 'knowledge');
		const form = formFields(await request.formData());
		let id: string;
		try {
			id = await saveFolder(m, form);
		} catch (err) {
			return failed(err, locals.requestId, form);
		}
		redirect(303, here(m.tenant.slug, id));
	},
	removeFolder: async ({ request, locals }) => {
		const m = await requireModule(locals, 'knowledge');
		const form = formFields(await request.formData());
		let parent: string | null;
		try {
			parent = await deleteFolder(m, form);
		} catch (err) {
			return failed(err, locals.requestId, form);
		}
		redirect(303, here(m.tenant.slug, parent));
	},
	article: async ({ request, locals }) => {
		const m = await requireModule(locals, 'knowledge');
		const form = formFields(await request.formData());
		let id: string;
		try {
			id = await saveArticle(m, { ...form, articleId: '', status: 'draft' });
		} catch (err) {
			return failed(err, locals.requestId, form);
		}
		redirect(303, `/t/${m.tenant.slug}/knowledge/${id}?edit=1`);
	}
};
