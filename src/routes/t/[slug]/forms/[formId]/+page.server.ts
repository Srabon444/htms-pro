import { error, redirect } from '@sveltejs/kit';
import { asc, ne } from 'drizzle-orm';
import { branches, departments, employees } from '#lib/server/db/schema/index.ts';
import { AppError } from '#lib/server/errors.ts';
import {
	addField,
	assignForm,
	deleteForm,
	endAssignment,
	formPage,
	removeField,
	setFormStatus
} from '#lib/server/forms.ts';
import { employeeActionError as failed, formFields } from '#lib/server/http/employee-form.ts';
import { requireModule } from '#lib/server/modules.ts';
import { userCtx } from '#lib/server/rbac/access.ts';
import { withTenant } from '#lib/server/tenancy/index.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const m = await requireModule(locals, 'forms');
	try {
		return await withTenant(userCtx(m), async (tx) => {
			const page = await formPage(tx, m, params.formId);
			const pick = page.manage && page.form.status === 'published';
			return {
				...page,
				departments: pick
					? await tx
							.select({ id: departments.id, name: departments.name })
							.from(departments)
							.orderBy(asc(departments.name))
					: [],
				branches: pick
					? await tx.select({ id: branches.id, name: branches.name }).from(branches).orderBy(asc(branches.name))
					: [],
				people: pick
					? await tx
							.select({ id: employees.id, name: employees.fullName })
							.from(employees)
							.where(ne(employees.status, 'exited'))
							.orderBy(asc(employees.fullName))
							.limit(500)
					: []
			};
		});
	} catch (err) {
		if (err instanceof AppError) error(err.status, err.message);
		throw err;
	}
};

const act =
	(
		done: string,
		run: (
			m: Awaited<ReturnType<typeof requireModule>>,
			formId: string,
			form: Record<string, string>
		) => Promise<unknown>
	) =>
	async ({ request, locals, params }: Parameters<Actions[string]>[0]) => {
		const m = await requireModule(locals, 'forms', 'form.manage');
		const form = formFields(await request.formData());
		try {
			await run(m, params.formId!, form);
		} catch (err) {
			return failed(err, locals.requestId, form);
		}
		return { done };
	};

export const actions: Actions = {
	field: act('Question added.', (m, id, form) => addField(m, id, form)),
	removeField: act('Question removed.', (m, id, form) => removeField(m, id, form.fieldId ?? '')),
	publish: act('Form published.', (m, id) => setFormStatus(m, id, 'published')),
	archive: act('Form archived.', (m, id) => setFormStatus(m, id, 'archived')),
	assign: act('Form assigned.', (m, id, form) => assignForm(m, id, form)),
	endAssignment: act('Assignment ended.', (m, id, form) => endAssignment(m, id, form.assignmentId ?? '')),
	remove: async ({ locals, params }) => {
		const m = await requireModule(locals, 'forms', 'form.manage');
		try {
			await deleteForm(m, params.formId);
		} catch (err) {
			return failed(err, locals.requestId, {});
		}
		redirect(303, `/t/${m.tenant.slug}/forms`);
	}
};
