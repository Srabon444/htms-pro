import { and, asc, count, desc, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AttachmentRules } from './attachments';
import { insertFiles, prepareFiles } from './attachments';
import { activeMembershipsOf } from './approval-chain';
import { now } from './clock';
import { addDays, zoneFormat } from './dates';
import { authPool } from './db';
import { pgCode, UNIQUE_VIOLATION } from './db/errors';
import {
	branches,
	departments,
	employees,
	FORM_AUDIENCES,
	FORM_FIELD_KINDS,
	FORM_SCHEDULES,
	formAssignments,
	formSubmissions,
	forms,
	MAX_ATTACHMENTS,
	MAX_FORM_FIELDS,
	tenants,
	tenantSettings,
	type FormAnswer,
	type FormField
} from './db/schema';
import { AppError } from './errors';
import { discardFiles, filesFor } from './file-store';
import { claimDay, tenantToday } from './lifecycle';
import { log } from './log';
import type { Mail } from './mail';
import { modulesOn } from './modules';
import { notify, sendAll } from './notifications';
import { can, userCtx, type requireMember } from './rbac/access';
import { inScope, resolveScope, scopeWhere } from './rbac/scope';
import { systemCtx, withTenant, type Tx } from './tenancy';

type Member = ReturnType<typeof requireMember>;
type Assignment = typeof formAssignments.$inferSelect;
type Form = typeof forms.$inferSelect;

export const FORMS = {
	assignments: 50,
	submissions: 200,
	history: 20,
	answer: 2000,
	maxNumber: 1_000_000_000,
	onceReminderDays: 7
};
const FILE_KINDS: FormField['kind'][] = ['photo', 'file'];
const IMAGES = ['image/png', 'image/jpeg', 'image/webp'];

const clean = (max: number, empty: string, long: string) =>
	z
		.string()
		.trim()
		.min(1, empty)
		.max(max, long)
		.refine((v) => !/\p{Cc}/u.test(v), 'Remove control characters.');
const checkbox = z.preprocess((v) => v === 'on' || v === true, z.boolean());
const day = (message: string) =>
	z.iso.date(message).refine((d) => d >= '2000-01-01' && d <= '2099-12-31', 'Choose a date between 2000 and 2099.');
const trimmed = <T extends z.ZodType>(rule: T) => z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), rule);
const optionalId = (message: string) => z.union([z.literal(''), z.uuid({ error: message })]).prefault('');

const formSchema = z.object({
	title: clean(120, 'Give the form a title.', 'Keep the title under 120 characters.'),
	description: z
		.string()
		.trim()
		.max(1000, 'Keep the description under 1000 characters.')
		.refine((v) => !v.includes('\0'), 'Remove unsupported characters.')
		.prefault('')
});

const fieldSchema = z
	.object({
		kind: z.enum(FORM_FIELD_KINDS, 'Choose the kind of answer.'),
		label: clean(200, 'Write the question.', 'Keep the question under 200 characters.'),
		required: checkbox,
		options: z.string().prefault('')
	})
	.transform((v, ctx) => {
		const options = [...new Set(v.options.split('\n').map((o) => o.trim()))].filter(Boolean);
		if (v.kind !== 'select' && v.kind !== 'multi') return { ...v, options: [] };
		if (options.length < 2 || options.length > 20 || options.some((o) => o.length > 100 || /\p{Cc}/u.test(o))) {
			ctx.addIssue({ code: 'custom', message: 'Give 2 to 20 choices, one per line, each under 100 characters.' });
			return z.NEVER;
		}
		return { ...v, options };
	});

const assignSchema = z
	.object({
		audience: z.enum(FORM_AUDIENCES, 'Choose who fills the form.'),
		departmentId: optionalId('Choose a department.'),
		branchId: optionalId('Choose a branch.'),
		employeeId: optionalId('Choose an employee.'),
		schedule: z.enum(FORM_SCHEDULES, 'Choose how often.'),
		weekday: z.union([z.literal(''), z.string().regex(/^[0-6]$/, 'Choose the day of the week.')]).prefault(''),
		remindHour: z
			.string('Choose the reminder hour.')
			.regex(/^(1?\d|2[0-3])$/, 'Choose the reminder hour.')
			.transform(Number),
		startsOn: day('Enter the start date.'),
		endsOn: z.union([z.literal(''), day('Enter the end date.')]).prefault('')
	})
	.transform((v, ctx) => {
		const target = { department: v.departmentId, branch: v.branchId, employee: v.employeeId } as const;
		if (v.audience !== 'all' && !target[v.audience]) {
			ctx.addIssue({ code: 'custom', message: `Choose the ${v.audience}.` });
			return z.NEVER;
		}
		if (v.schedule === 'weekly' && v.weekday === '') {
			ctx.addIssue({ code: 'custom', message: 'Choose the day of the week.' });
			return z.NEVER;
		}
		if (v.endsOn && v.endsOn < v.startsOn) {
			ctx.addIssue({ code: 'custom', message: 'The end date cannot be before the start date.' });
			return z.NEVER;
		}
		return {
			audience: v.audience,
			departmentId: v.audience === 'department' ? v.departmentId : null,
			branchId: v.audience === 'branch' ? v.branchId : null,
			employeeId: v.audience === 'employee' ? v.employeeId : null,
			schedule: v.schedule,
			weekday: v.schedule === 'weekly' ? Number(v.weekday) : null,
			remindHour: v.remindHour,
			startsOn: v.startsOn,
			endsOn: v.endsOn || null
		};
	});

const coordinate = (max: number) =>
	trimmed(z.union([z.literal(''), z.coerce.number().min(-max).max(max)])).prefault('');
const location = z
	.object({ lat: coordinate(90), lng: coordinate(180) })
	.transform((v) => (v.lat === '' || v.lng === '' ? { lat: null, lng: null } : { lat: v.lat, lng: v.lng }));

const formMissing = () => new AppError('not_found', 'That form does not exist.', 404);
const assignmentMissing = () => new AppError('not_found', 'That form is not assigned to you.', 404);
const forbidden = () => new AppError('forbidden', 'You cannot manage forms.', 403);
const mustManage = (m: Member) => {
	if (!can(m.access, 'form.manage')) throw forbidden();
};

const weekdayOf = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();

export function periodFor(a: Pick<Assignment, 'schedule' | 'weekday' | 'startsOn' | 'endsOn'>, today: string) {
	if (today < a.startsOn || (a.endsOn && today > a.endsOn)) return null;
	if (a.schedule === 'once') return a.startsOn;
	if (a.schedule === 'daily') return today;
	const start = addDays(today, -((weekdayOf(today) - (a.weekday ?? 0) + 7) % 7));
	return start < a.startsOn ? a.startsOn : start;
}

function answerFor(f: FormField): z.ZodType<FormAnswer> {
	const msg = `Answer "${f.label}".`;
	const optional = (rule: z.ZodType<FormAnswer>) =>
		trimmed(f.required ? rule : z.union([z.literal('').transform(() => null), rule])).prefault('');
	const choice = () => z.enum(f.options as [string, ...string[]], `Choose an answer for "${f.label}".`);
	switch (f.kind) {
		case 'text':
			return optional(
				z
					.string()
					.trim()
					.min(1, msg)
					.max(FORMS.answer, `Keep "${f.label}" under ${FORMS.answer} characters.`)
					.refine((v) => !v.includes('\0'), 'Remove unsupported characters.')
			);
		case 'number':
			return optional(
				z
					.string()
					.trim()
					.regex(/^-?\d{1,10}(\.\d{1,4})?$/, `Enter a number for "${f.label}".`)
					.transform(Number)
					.refine((n) => Math.abs(n) < FORMS.maxNumber, `Enter a smaller number for "${f.label}".`)
			);
		case 'date':
			return optional(day(`Enter a date for "${f.label}".`));
		case 'select':
			return optional(choice());
		case 'multi':
			return z
				.array(choice())
				.transform((list) => [...new Set(list)])
				.refine((list) => !f.required || list.length > 0, `Choose at least one answer for "${f.label}".`);
		case 'checkbox':
			return optional(z.enum(['yes', 'no'], msg).transform((v) => v === 'yes'));
		default:
			return checkbox.refine((v) => v, `Confirm "${f.label}".`);
	}
}

export const answerSchema = (fields: FormField[]) =>
	z.object(Object.fromEntries(fields.filter((f) => !FILE_KINDS.includes(f.kind)).map((f) => [f.id, answerFor(f)])));

export async function createForm(m: Member, form: Record<string, string>) {
	mustManage(m);
	const input = formSchema.parse(form);
	return withTenant(userCtx(m), async (tx) => {
		const [row] = await tx
			.insert(forms)
			.values({
				tenantId: m.tenant.id,
				title: input.title,
				description: input.description || null,
				createdByUserId: m.user.userId
			})
			.returning({ id: forms.id });
		return row.id;
	});
}

async function lockedForm(tx: Tx, formId: string) {
	if (!z.uuid().safeParse(formId).success) throw formMissing();
	const [f] = await tx.select().from(forms).where(eq(forms.id, formId)).for('update');
	if (!f) throw formMissing();
	return f;
}

const mustBeDraft = (f: Form) => {
	if (f.status !== 'draft')
		throw new AppError('published', 'Questions can only change while the form is a draft.', 409);
};

export async function addField(m: Member, formId: string, form: Record<string, string>) {
	mustManage(m);
	const input = fieldSchema.parse(form);
	await withTenant(userCtx(m), async (tx) => {
		const f = await lockedForm(tx, formId);
		mustBeDraft(f);
		if (f.fields.length >= MAX_FORM_FIELDS)
			throw new AppError('too_many', `A form can have at most ${MAX_FORM_FIELDS} questions.`, 409);
		if (
			FILE_KINDS.includes(input.kind) &&
			f.fields.filter((x) => FILE_KINDS.includes(x.kind)).length >= MAX_ATTACHMENTS
		)
			throw new AppError('too_many', `A form can ask for at most ${MAX_ATTACHMENTS} photos or files.`, 409);
		const field: FormField = { id: `f${randomUUID().slice(0, 8)}`, ...input };
		await tx
			.update(forms)
			.set({ fields: [...f.fields, field] })
			.where(eq(forms.id, f.id));
	});
}

export async function removeField(m: Member, formId: string, fieldId: string) {
	mustManage(m);
	await withTenant(userCtx(m), async (tx) => {
		const f = await lockedForm(tx, formId);
		mustBeDraft(f);
		await tx
			.update(forms)
			.set({ fields: f.fields.filter((x) => x.id !== fieldId) })
			.where(eq(forms.id, f.id));
	});
}

export async function setFormStatus(m: Member, formId: string, status: 'published' | 'archived') {
	mustManage(m);
	await withTenant(userCtx(m), async (tx) => {
		const f = await lockedForm(tx, formId);
		if (status === 'published' && f.status !== 'draft')
			throw new AppError('not_draft', 'Only a draft can be published.', 409);
		if (status === 'published' && !f.fields.length)
			throw new AppError('no_fields', 'Add at least one question before publishing.', 409);
		if (status === 'archived' && f.status !== 'published')
			throw new AppError('not_published', 'Only a published form can be archived.', 409);
		await tx.update(forms).set({ status }).where(eq(forms.id, f.id));
	});
}

export async function deleteForm(m: Member, formId: string) {
	mustManage(m);
	await withTenant(userCtx(m), async (tx) => {
		const f = await lockedForm(tx, formId);
		if (f.status !== 'draft') throw new AppError('not_draft', 'Only a draft can be deleted. Archive it instead.', 409);
		await tx.delete(forms).where(eq(forms.id, f.id));
	});
}

async function checkTarget(tx: Tx, a: z.infer<typeof assignSchema>) {
	const found = a.departmentId
		? await tx.select({ id: departments.id }).from(departments).where(eq(departments.id, a.departmentId))
		: a.branchId
			? await tx.select({ id: branches.id }).from(branches).where(eq(branches.id, a.branchId))
			: a.employeeId
				? await tx
						.select({ id: employees.id })
						.from(employees)
						.where(and(eq(employees.id, a.employeeId), sql`${employees.status} <> 'exited'`))
				: [{ id: 'all' }];
	if (!found.length) throw new AppError('bad_target', `Choose an existing ${a.audience}.`, 400);
}

export async function assignForm(m: Member, formId: string, form: Record<string, string>) {
	mustManage(m);
	const input = assignSchema.parse(form);
	await withTenant(userCtx(m), async (tx) => {
		const f = await lockedForm(tx, formId);
		if (f.status !== 'published') throw new AppError('not_published', 'Publish the form before assigning it.', 409);
		if (input.startsOn < (await tenantToday(tx)))
			throw new AppError('past_start', 'The assignment cannot start in the past.', 400);
		await checkTarget(tx, input);
		const [{ n }] = await tx
			.select({ n: count() })
			.from(formAssignments)
			.where(
				and(
					eq(formAssignments.formId, f.id),
					or(isNull(formAssignments.endsOn), gte(formAssignments.endsOn, input.startsOn))
				)
			);
		if (n >= FORMS.assignments)
			throw new AppError('too_many', `A form can have at most ${FORMS.assignments} assignments.`, 409);
		await tx
			.insert(formAssignments)
			.values({ tenantId: m.tenant.id, formId: f.id, ...input, createdByUserId: m.user.userId });
	});
}

export async function endAssignment(m: Member, formId: string, assignmentId: string) {
	mustManage(m);
	await withTenant(userCtx(m), async (tx) => {
		const gone = () => new AppError('not_found', 'That assignment does not exist.', 404);
		if (!z.uuid().safeParse(assignmentId).success || !z.uuid().safeParse(formId).success) throw gone();
		const [a] = await tx
			.select()
			.from(formAssignments)
			.where(and(eq(formAssignments.id, assignmentId), eq(formAssignments.formId, formId)))
			.for('update');
		if (!a) throw gone();
		const today = await tenantToday(tx);
		if (a.endsOn && a.endsOn < today) return;
		const [sent] = await tx
			.select({ id: formSubmissions.id })
			.from(formSubmissions)
			.where(eq(formSubmissions.assignmentId, a.id))
			.limit(1);
		const yesterday = addDays(today, -1);
		if (!sent && a.startsOn >= today) await tx.delete(formAssignments).where(eq(formAssignments.id, a.id));
		else
			await tx
				.update(formAssignments)
				.set({ endsOn: a.startsOn > yesterday ? a.startsOn : yesterday })
				.where(eq(formAssignments.id, a.id));
	});
}

async function departmentChain(tx: Tx, departmentId: string | null) {
	if (!departmentId) return [];
	const rows = await tx.execute<{ id: string }>(sql`
		with recursive up(id, parent_id, depth) as (
			select id, parent_id, 0 from departments where id = ${departmentId}::uuid
			union all
			select d.id, d.parent_id, up.depth + 1 from departments d join up on d.id = up.parent_id where up.depth < 20
		)
		select id from up`);
	return rows.map((r) => r.id);
}

async function assignmentsOf(tx: Tx, employeeId: string, onlyId?: string) {
	const [e] = await tx.select().from(employees).where(eq(employees.id, employeeId));
	if (!e || e.status === 'exited') return { today: await tenantToday(tx), rows: [] };
	const chain = await departmentChain(tx, e.departmentId);
	const rows = await tx
		.select({ a: formAssignments, f: forms })
		.from(formAssignments)
		.innerJoin(forms, eq(forms.id, formAssignments.formId))
		.where(
			and(
				eq(forms.status, 'published'),
				onlyId ? eq(formAssignments.id, onlyId) : undefined,
				sql`(${formAssignments.audience} = 'all'
					or ${formAssignments.employeeId} = ${employeeId}::uuid
					or (${formAssignments.branchId} is not null and ${formAssignments.branchId} = ${e.branchId}::uuid)
					or ${chain.length ? inArray(formAssignments.departmentId, chain) : sql`false`})`
			)
		)
		.orderBy(asc(forms.title))
		.limit(200);
	const today = await tenantToday(tx);
	return {
		today,
		rows: rows.flatMap((r, i) => {
			const period = periodFor(r.a, today);
			const first = rows.findIndex((o) => o.f.id === r.f.id && periodFor(o.a, today) === period) === i;
			return period && first ? [{ ...r, period }] : [];
		})
	};
}

export async function dueForms(tx: Tx, employeeId: string) {
	const { rows } = await assignmentsOf(tx, employeeId);
	const done = rows.length
		? await tx
				.select({ formId: formSubmissions.formId, period: formSubmissions.period })
				.from(formSubmissions)
				.where(
					and(
						eq(formSubmissions.employeeId, employeeId),
						inArray(
							formSubmissions.formId,
							rows.map((r) => r.f.id)
						)
					)
				)
		: [];
	return rows
		.filter((r) => !done.some((d) => d.formId === r.f.id && d.period === r.period))
		.map((r) => ({
			assignmentId: r.a.id,
			formId: r.f.id,
			title: r.f.title,
			schedule: r.a.schedule,
			period: r.period
		}));
}

export async function fillPage(m: Member, assignmentId: string) {
	const employeeId = m.access.employeeId;
	if (!employeeId || !z.uuid().safeParse(assignmentId).success) throw assignmentMissing();
	return withTenant(userCtx(m), async (tx) => {
		const { rows } = await assignmentsOf(tx, employeeId, assignmentId);
		const r = rows[0];
		if (!r) throw assignmentMissing();
		const [done] = await tx
			.select({ id: formSubmissions.id })
			.from(formSubmissions)
			.where(
				and(
					eq(formSubmissions.formId, r.f.id),
					eq(formSubmissions.employeeId, employeeId),
					eq(formSubmissions.period, r.period)
				)
			);
		return {
			assignmentId: r.a.id,
			title: r.f.title,
			description: r.f.description,
			fields: r.f.fields,
			period: r.period,
			schedule: r.a.schedule,
			submitted: !!done
		};
	});
}

export async function submitForm(m: Member, assignmentId: string, data: FormData) {
	const employeeId = m.access.employeeId;
	if (!employeeId || !z.uuid().safeParse(assignmentId).success) throw assignmentMissing();
	const page = await fillPage(m, assignmentId);
	if (page.submitted) throw new AppError('already_submitted', 'You already sent this form for this period.', 409);
	const raw: Record<string, unknown> = {};
	for (const f of page.fields) raw[f.id] = f.kind === 'multi' ? data.getAll(f.id) : (data.get(f.id) ?? undefined);
	const answers: Record<string, FormAnswer> = answerSchema(page.fields).parse(raw);
	const place = location.parse({ lat: data.get('lat') ?? undefined, lng: data.get('lng') ?? undefined });
	const uploads = page.fields.filter((f) => FILE_KINDS.includes(f.kind));
	const picked = uploads.flatMap((f) => {
		const v = data.get(f.id);
		return v instanceof File && v.size ? [{ field: f, file: v }] : [];
	});
	const missing = uploads.find((f) => f.required && !picked.some((p) => p.field.id === f.id));
	if (missing) throw new AppError('missing_file', `Add "${missing.label}".`, 400);
	const stored = picked.length
		? await prepareFiles(
				m.tenant.id,
				'form_submission',
				picked.map((p) => p.file)
			)
		: [];
	try {
		picked.forEach((p, i) => {
			if (p.field.kind === 'photo' && !IMAGES.includes(stored[i].mime))
				throw new AppError('not_photo', `"${p.field.label}" must be a PNG, JPEG or WEBP photo.`, 415);
		});
		return await withTenant(userCtx(m), async (tx) => {
			const { rows } = await assignmentsOf(tx, employeeId, assignmentId);
			const r = rows[0];
			if (!r || r.period !== page.period) throw assignmentMissing();
			const [row] = await tx
				.insert(formSubmissions)
				.values({
					tenantId: m.tenant.id,
					formId: r.f.id,
					assignmentId: r.a.id,
					employeeId,
					period: r.period,
					answers,
					...place,
					submittedByUserId: m.user.userId
				})
				.returning({ id: formSubmissions.id })
				.catch((err) => {
					if (pgCode(err) === UNIQUE_VIOLATION)
						throw new AppError('already_submitted', 'You already sent this form for this period.', 409);
					throw err;
				});
			if (stored.length) {
				const ids = await insertFiles(tx, userCtx(m), 'form_submission', row.id, stored);
				await tx
					.update(formSubmissions)
					.set({ answers: { ...answers, ...Object.fromEntries(picked.map((p, i) => [p.field.id, ids[i]])) } })
					.where(eq(formSubmissions.id, row.id));
			}
			return row.id;
		});
	} catch (err) {
		await discardFiles(stored);
		throw err;
	}
}

export async function formsPage(tx: Tx, m: Member) {
	const me = m.access.employeeId;
	const manage = can(m.access, 'form.manage');
	const read = can(m.access, 'form.read');
	const history = me
		? await tx
				.select({
					id: formSubmissions.id,
					title: forms.title,
					period: formSubmissions.period,
					at: formSubmissions.createdAt
				})
				.from(formSubmissions)
				.innerJoin(forms, eq(forms.id, formSubmissions.formId))
				.where(eq(formSubmissions.employeeId, me))
				.orderBy(desc(formSubmissions.createdAt))
				.limit(FORMS.history)
		: [];
	const list =
		manage || read
			? await tx
					.select({ id: forms.id, title: forms.title, status: forms.status, fields: forms.fields })
					.from(forms)
					.where(manage ? undefined : sql`${forms.status} <> 'draft'`)
					.orderBy(asc(forms.status), asc(forms.title))
					.limit(200)
			: [];
	return {
		due: me ? await dueForms(tx, me) : [],
		history,
		manage,
		forms: list.map((f) => ({ id: f.id, title: f.title, status: f.status, questions: f.fields.length }))
	};
}

export async function formPage(tx: Tx, m: Member, formId: string) {
	const manage = can(m.access, 'form.manage');
	const scope = await resolveScope(tx, m.access, 'form.read');
	if (!manage && !can(m.access, 'form.read')) throw formMissing();
	if (!z.uuid().safeParse(formId).success) throw formMissing();
	const [f] = await tx.select().from(forms).where(eq(forms.id, formId));
	if (!f || (!manage && f.status === 'draft')) throw formMissing();
	const assignments = manage
		? await tx
				.select({
					a: formAssignments,
					department: departments.name,
					branch: branches.name,
					employee: employees.fullName
				})
				.from(formAssignments)
				.leftJoin(departments, eq(departments.id, formAssignments.departmentId))
				.leftJoin(branches, eq(branches.id, formAssignments.branchId))
				.leftJoin(employees, eq(employees.id, formAssignments.employeeId))
				.where(eq(formAssignments.formId, f.id))
				.orderBy(asc(formAssignments.startsOn))
		: [];
	const submissions = await tx
		.select({
			id: formSubmissions.id,
			employeeId: formSubmissions.employeeId,
			name: employees.fullName,
			period: formSubmissions.period,
			answers: formSubmissions.answers,
			lat: formSubmissions.lat,
			lng: formSubmissions.lng,
			at: formSubmissions.createdAt
		})
		.from(formSubmissions)
		.innerJoin(employees, eq(employees.id, formSubmissions.employeeId))
		.where(and(eq(formSubmissions.formId, f.id), scopeWhere(scope, formSubmissions.employeeId)))
		.orderBy(desc(formSubmissions.createdAt))
		.limit(FORMS.submissions);
	const attached = await filesFor(
		tx,
		'form_submission',
		submissions.map((s) => s.id)
	);
	return {
		form: { id: f.id, title: f.title, description: f.description, status: f.status, fields: f.fields },
		manage,
		today: await tenantToday(tx),
		assignments: assignments.map((r) => ({
			...r.a,
			target: r.department ?? r.branch ?? r.employee ?? 'Everyone'
		})),
		submissions: submissions.map((s) => ({ ...s, files: attached.get(s.id) ?? [] }))
	};
}

export const formSubmissionAttachments: AttachmentRules = {
	async canRead(tx, access, id) {
		const [s] = await tx
			.select({ employeeId: formSubmissions.employeeId })
			.from(formSubmissions)
			.where(eq(formSubmissions.id, id));
		if (!s) return false;
		return s.employeeId === access.employeeId || inScope(await resolveScope(tx, access, 'form.read'), s.employeeId);
	},
	async canEdit() {
		return false;
	}
};

const pendingFor = (a: Assignment, period: string) => sql`
	with recursive down(id, depth) as (
		select id, 0 from departments where id = ${a.departmentId}::uuid
		union all
		select d.id, down.depth + 1 from departments d join down on d.parent_id = down.id where down.depth < 20
	)
	select e.id from employees e
	where e.status <> 'exited' and (
		${a.audience} = 'all'
		or (${a.audience} = 'department' and e.department_id in (select id from down))
		or (${a.audience} = 'branch' and e.branch_id = ${a.branchId}::uuid)
		or (${a.audience} = 'employee' and e.id = ${a.employeeId}::uuid))
	and not exists (select 1 from form_submissions s where s.form_id = ${a.formId}::uuid
		and s.employee_id = e.id and s.period = ${period}::date)`;

export async function formReminders(tenantId: string, slug: string): Promise<Mail[]> {
	return withTenant(systemCtx(tenantId), async (tx) => {
		if (!(await modulesOn(tx)).has('forms')) return [];
		const [s] = await tx.select({ tz: tenantSettings.timezone }).from(tenantSettings);
		const hour = Number(zoneFormat(s?.tz ?? 'UTC', { hour: '2-digit', hourCycle: 'h23' }).format(now()));
		const today = await tenantToday(tx);
		if (!(await claimDay(tx, tenantId, `form_reminders_${hour}`, today))) return [];
		const live = await tx
			.select({ a: formAssignments, title: forms.title })
			.from(formAssignments)
			.innerJoin(forms, eq(forms.id, formAssignments.formId))
			.where(and(eq(forms.status, 'published'), eq(formAssignments.remindHour, hour)));
		const told = new Set<string>();
		return live.reduce<Promise<Mail[]>>(async (prior, { a, title }) => {
			const all = await prior;
			const period = periodFor(a, today);
			if (!period || (a.schedule === 'weekly' && period !== today)) return all;
			if (a.schedule === 'once' && today > addDays(a.startsOn, FORMS.onceReminderDays - 1)) return all;
			const people = (await tx.execute<{ id: string }>(pendingFor(a, period))).filter((p) => {
				const key = `${a.formId}:${period}:${p.id}`;
				return !told.has(key) && !!told.add(key);
			});
			if (!people.length) return all;
			return [
				...all,
				...(await notify(
					tx,
					tenantId,
					await activeMembershipsOf(
						tx,
						people.map((p) => p.id)
					),
					{ category: 'forms', title: `Form to fill: ${title}`, link: `forms/fill/${a.id}` },
					slug
				))
			];
		}, Promise.resolve([]));
	});
}

export async function runFormReminders() {
	const list = await authPool()
		.db.select({ id: tenants.id, slug: tenants.slug })
		.from(tenants)
		.where(eq(tenants.status, 'active'));
	await list.reduce<Promise<void>>(
		(prior, t) =>
			prior.then(() =>
				formReminders(t.id, t.slug)
					.then(sendAll)
					.catch((err) => log.error({ tenantId: t.id, err: (err as Error).message }, 'form reminders failed'))
			),
		Promise.resolve()
	);
}
