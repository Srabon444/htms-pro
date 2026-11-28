import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MODULE_IDS, MODULES } from '../../src/lib/modules';
import { openFile } from '../../src/lib/server/attachments';
import { withTestNow } from '../../src/lib/server/clock';
import { closePools, ownerPool } from '../../src/lib/server/db';
import {
	formAssignments,
	formSubmissions,
	forms,
	memberships,
	notifications,
	tasks
} from '../../src/lib/server/db/schema';
import { createEmployee, EMPLOYMENT_FIELDS, PROFILE_FIELDS } from '../../src/lib/server/employees';
import {
	addField,
	assignForm,
	createForm,
	deleteForm,
	endAssignment,
	fillPage,
	formPage,
	formReminders,
	formsPage,
	removeField,
	setFormStatus,
	submitForm
} from '../../src/lib/server/forms';
import { saveModules } from '../../src/lib/server/modules';
import { addMember, seedTenant } from '../../src/lib/server/platform/tenants';
import { loadAccess, userCtx, type requireMember } from '../../src/lib/server/rbac/access';
import { createTask, deleteTask, setTaskStatus, taskBoard } from '../../src/lib/server/tasks';
import { systemCtx, withTenant } from '../../src/lib/server/tenancy';
import { createTenant, createUser, TEST_LOCALE } from './helpers';
import { expectScoped, leakWorld } from './leak';

type Member = ReturnType<typeof requireMember>;
let tenant: { id: string; slug: string };
const ids: Record<string, string> = {};
const who: Record<string, Member> = {};
const sys = () => systemCtx(tenant.id);
const NOW = '2026-12-07T03:30:00Z';
const TODAY = '2026-12-07';
const at = <T>(fn: () => Promise<T>, iso = NOW) => withTestNow(iso, fn);
const code = (p: () => Promise<unknown>, iso = NOW) =>
	at(p, iso)
		.then(() => 'ok')
		.catch((e: { code?: string; issues?: { message: string }[] }) =>
			e.issues ? `invalid: ${e.issues[0].message}` : (e.code ?? String(e))
		);
const blanks = Object.fromEntries(Object.keys({ ...PROFILE_FIELDS, ...EMPLOYMENT_FIELDS }).map((k) => [k, '']));
const creator = {
	membershipId: '',
	employeeId: null,
	grants: { 'employee.read': ['all'], 'employee.create': ['all'], 'employee.update': ['all'] },
	roleKeys: [],
	isOwner: false
};
const hire = (fullName: string, managerId = '') =>
	at(() =>
		createEmployee({ tenantId: tenant.id, actor: 'user' }, creator as never, {
			...blanks,
			fullName,
			managerId,
			employmentType: 'full_time',
			status: 'active',
			joinDate: '2026-01-01'
		})
	);

async function member(key: string, roleKeys: string[], employeeId: string | null) {
	const u = await createUser();
	const id = await withTenant(sys(), async (tx) => {
		const membershipId = await addMember(tx, tenant.id, u.id, roleKeys);
		await tx.update(memberships).set({ employeeId }).where(eq(memberships.id, membershipId));
		return membershipId;
	});
	ids[`${key}Membership`] = id;
	who[key] = {
		user: { userId: u.id },
		tenant: { id: tenant.id, slug: tenant.slug, name: tenant.slug },
		access: await loadAccess(tenant.id, { id, status: 'active', employeeId })
	} as unknown as Member;
}

const plan = (over: Record<string, string> = {}) => ({
	audience: 'all',
	schedule: 'once',
	remindHour: '9',
	startsOn: TODAY,
	...over
});
const fd = (entries: [string, string | File][]) => {
	const d = new FormData();
	for (const [k, v] of entries) d.append(k, v);
	return d;
};
const png = () => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1])], 'shelf.png');
const pdf = () => new File(['%PDF-1.7 report'], 'report.pdf', { type: 'application/pdf' });
const formOf = (id: string) => withTenant(sys(), (tx) => tx.select().from(forms).where(eq(forms.id, id)));
const assignmentsOf = (formId: string) =>
	withTenant(sys(), (tx) => tx.select().from(formAssignments).where(eq(formAssignments.formId, formId)));
const due = (key: string, iso = NOW) =>
	at(() => withTenant(userCtx(who[key]), (tx) => formsPage(tx, who[key])), iso).then((p) => p.due);
const page = (key: string, formId: string) =>
	at(() => withTenant(userCtx(who[key]), (tx) => formPage(tx, who[key], formId)));
const inbox = (key: string) =>
	withTenant(sys(), (tx) =>
		tx
			.select({ title: notifications.title, link: notifications.link, category: notifications.category })
			.from(notifications)
			.where(eq(notifications.membershipId, ids[`${key}Membership`]))
	);

async function published(title: string, fields: Record<string, string>[]) {
	const id = await at(() => createForm(who.hr, { title, description: '' }));
	for (const f of fields) await at(() => addField(who.hr, id, f));
	await at(() => setFormStatus(who.hr, id, 'published'));
	return { id, fields: (await formOf(id))[0].fields };
}

beforeAll(async () => {
	tenant = await createTenant('forms');
	await withTenant(sys(), (tx) => seedTenant(tx, tenant.id, TEST_LOCALE));
	const sql = ownerPool().sql;
	const [ops] = await sql<{ id: string }[]>`
		insert into departments (tenant_id, name) values (${tenant.id}, 'Ops') returning id`;
	const [north] = await sql<{ id: string }[]>`
		insert into departments (tenant_id, name, parent_id) values (${tenant.id}, 'Ops North', ${ops.id}) returning id`;
	const [dhaka] = await sql<{ id: string }[]>`
		insert into branches (tenant_id, name) values (${tenant.id}, 'Dhaka Shop') returning id`;
	ids.ops = ops.id;
	ids.north = north.id;
	ids.dhaka = dhaka.id;
	ids.mgr = await hire('Mia');
	ids.ann = await hire('Ann', ids.mgr);
	ids.bob = await hire('Bob');
	ids.gone = await hire('Gone');
	await sql`update employees set department_id = ${north.id} where id = ${ids.ann}`;
	await sql`update employees set branch_id = ${dhaka.id} where id = ${ids.bob}`;
	await sql`update employees set status = 'exited' where id = ${ids.gone}`;
	await member('hr', ['hr_admin'], null);
	await member('mgr', ['line_manager', 'employee'], ids.mgr);
	await member('ann', ['employee'], ids.ann);
	await member('bob', ['employee'], ids.bob);
	await saveModules(sys(), [...MODULE_IDS.filter((m) => MODULES[m].on), 'forms']);
});

afterAll(closePools);

describe('form builder', () => {
	it('only lets form managers build forms', async () => {
		expect(await code(() => createForm(who.ann, { title: 'Mine' }))).toBe('forbidden');
		expect(await code(() => createForm(who.hr, { title: '  ' }))).toBe('invalid: Give the form a title.');
	});

	it('checks questions and keeps them fixed after publishing', async () => {
		const id = await at(() => createForm(who.hr, { title: 'Store check', description: 'Every morning' }));
		expect(await code(() => setFormStatus(who.hr, id, 'published'))).toBe('no_fields');
		expect(await code(() => addField(who.hr, id, { kind: 'select', label: 'Open?', options: 'Yes' }))).toBe(
			'invalid: Give 2 to 20 choices, one per line, each under 100 characters.'
		);
		expect(await code(() => addField(who.hr, id, { kind: 'essay', label: 'Notes' }))).toBe(
			'invalid: Choose the kind of answer.'
		);
		expect(await code(() => addField(who.ann, id, { kind: 'text', label: 'Notes' }))).toBe('forbidden');
		await at(() => addField(who.hr, id, { kind: 'select', label: 'Open?', options: 'Yes\nNo\nYes\n', required: 'on' }));
		await at(() => addField(who.hr, id, { kind: 'text', label: 'Notes', options: 'ignored' }));
		const [f] = await formOf(id);
		expect(f.fields.map((x) => [x.kind, x.label, x.required, x.options])).toEqual([
			['select', 'Open?', true, ['Yes', 'No']],
			['text', 'Notes', false, []]
		]);
		await at(() => removeField(who.hr, id, f.fields[1].id));
		expect((await formOf(id))[0].fields).toHaveLength(1);
		await at(() => setFormStatus(who.hr, id, 'published'));
		expect(await code(() => addField(who.hr, id, { kind: 'text', label: 'Late' }))).toBe('published');
		expect(await code(() => removeField(who.hr, id, f.fields[0].id))).toBe('published');
		expect(await code(() => deleteForm(who.hr, id))).toBe('not_draft');
		expect(await code(() => setFormStatus(who.hr, id, 'published'))).toBe('not_draft');
	});

	it('caps photo and file questions at five', async () => {
		const id = await at(() => createForm(who.hr, { title: 'Photos' }));
		for (let i = 0; i < 5; i++) await at(() => addField(who.hr, id, { kind: 'photo', label: `Shelf ${i}` }));
		expect(await code(() => addField(who.hr, id, { kind: 'file', label: 'One more' }))).toBe('too_many');
		await at(() => addField(who.hr, id, { kind: 'text', label: 'Text still fine' }));
		await at(() => deleteForm(who.hr, id));
		expect(await formOf(id)).toEqual([]);
	});

	it('rejects unknown forms', async () => {
		expect(await code(() => addField(who.hr, crypto.randomUUID(), { kind: 'text', label: 'x' }))).toBe('not_found');
		expect(await code(() => setFormStatus(who.hr, 'nope', 'archived'))).toBe('not_found');
	});
});

describe('assignments', () => {
	let form: Awaited<ReturnType<typeof published>>;
	beforeAll(async () => {
		form = await published('Weekly safety', [{ kind: 'checkbox', label: 'Exits clear', required: 'on' }]);
	});

	it('checks who and when on the server', async () => {
		const draft = await at(() => createForm(who.hr, { title: 'Draft only' }));
		expect(await code(() => assignForm(who.hr, draft, plan()))).toBe('not_published');
		expect(await code(() => assignForm(who.ann, form.id, plan()))).toBe('forbidden');
		expect(await code(() => assignForm(who.hr, form.id, plan({ startsOn: '2026-12-06' })))).toBe('past_start');
		expect(await code(() => assignForm(who.hr, form.id, plan({ audience: 'department' })))).toBe(
			'invalid: Choose the department.'
		);
		expect(await code(() => assignForm(who.hr, form.id, plan({ schedule: 'weekly' })))).toBe(
			'invalid: Choose the day of the week.'
		);
		expect(await code(() => assignForm(who.hr, form.id, plan({ endsOn: '2026-12-01' })))).toBe(
			'invalid: The end date cannot be before the start date.'
		);
		for (const remindHour of ['24', '', '1e1', ' 9'])
			expect(await code(() => assignForm(who.hr, form.id, plan({ remindHour })))).toBe(
				'invalid: Choose the reminder hour.'
			);
		expect(await code(() => assignForm(who.hr, form.id, plan({ schedule: 'weekly', weekday: ' ' })))).toBe(
			'invalid: Choose the day of the week.'
		);
		for (const target of <Record<string, string>[]>[
			{ audience: 'department', departmentId: crypto.randomUUID() },
			{ audience: 'branch', branchId: crypto.randomUUID() },
			{ audience: 'employee', employeeId: crypto.randomUUID() },
			{ audience: 'employee', employeeId: ids.gone }
		])
			expect(await code(() => assignForm(who.hr, form.id, plan(target)))).toBe('bad_target');
		expect(await assignmentsOf(form.id)).toEqual([]);
	});

	it('reaches the right people and drops the unused target ids', async () => {
		await at(() =>
			assignForm(who.hr, form.id, plan({ audience: 'department', departmentId: ids.ops, branchId: ids.dhaka }))
		);
		const [a] = await assignmentsOf(form.id);
		expect(a).toMatchObject({ audience: 'department', departmentId: ids.ops, branchId: null, weekday: null });
		expect((await due('ann')).map((d) => d.title)).toContain('Weekly safety');
		expect((await due('bob')).map((d) => d.title)).not.toContain('Weekly safety');
		await at(() => assignForm(who.hr, form.id, plan({ audience: 'branch', branchId: ids.dhaka })));
		expect((await due('bob')).map((d) => d.title)).toContain('Weekly safety');
		expect((await due('mgr')).map((d) => d.title)).not.toContain('Weekly safety');
		await at(() => assignForm(who.hr, form.id, plan({ audience: 'employee', employeeId: ids.mgr })));
		expect((await due('mgr')).map((d) => d.title)).toContain('Weekly safety');
	});

	it('stops an ended assignment at once, and drops one nobody has sent', async () => {
		await at(() => assignForm(who.hr, form.id, plan({ startsOn: '2026-12-20' })));
		const later = (await assignmentsOf(form.id)).find((a) => a.startsOn === '2026-12-20')!;
		await at(() => endAssignment(who.hr, form.id, later.id));
		expect((await assignmentsOf(form.id)).some((a) => a.id === later.id)).toBe(false);
		const mine = (await assignmentsOf(form.id)).find((a) => a.audience === 'employee')!;
		expect(await code(() => endAssignment(who.ann, form.id, mine.id))).toBe('forbidden');
		expect(await code(() => endAssignment(who.hr, crypto.randomUUID(), mine.id))).toBe('not_found');
		expect(await code(() => endAssignment(who.hr, form.id, 'nope'))).toBe('not_found');
		await at(() => endAssignment(who.hr, form.id, mine.id));
		expect((await assignmentsOf(form.id)).some((a) => a.id === mine.id)).toBe(false);
		expect((await due('mgr')).map((d) => d.title)).not.toContain('Weekly safety');

		const sql = ownerPool().sql;
		const [old] = await sql<{ id: string }[]>`
			insert into form_assignments (tenant_id, form_id, audience, employee_id, schedule, remind_hour, starts_on, created_by_user_id)
			values (${tenant.id}, ${form.id}, 'employee', ${ids.mgr}, 'daily', 9, '2026-12-01', gen_random_uuid()) returning id`;
		await sql`insert into form_submissions (tenant_id, form_id, assignment_id, employee_id, period, answers, submitted_by_user_id)
			values (${tenant.id}, ${form.id}, ${old.id}, ${ids.mgr}, '2026-12-02', '{}', gen_random_uuid())`;
		expect((await due('mgr')).map((d) => d.title)).toContain('Weekly safety');
		await at(() => endAssignment(who.hr, form.id, old.id));
		expect((await assignmentsOf(form.id)).find((a) => a.id === old.id)?.endsOn).toBe('2026-12-06');
		expect((await due('mgr')).map((d) => d.title)).not.toContain('Weekly safety');
		expect((await page('hr', form.id)).submissions.map((s) => s.employeeId)).toContain(ids.mgr);
	});

	it('counts only live assignments towards the limit', async () => {
		const f = await published('Busy form', [{ kind: 'text', label: 'Anything' }]);
		const sql = ownerPool().sql;
		for (let i = 0; i < 50; i++)
			await sql`insert into form_assignments (tenant_id, form_id, audience, schedule, remind_hour, starts_on, ends_on, created_by_user_id)
				values (${tenant.id}, ${f.id}, 'all', 'once', 9, '2026-11-01', '2026-11-02', gen_random_uuid())`;
		expect(await code(() => assignForm(who.hr, f.id, plan()))).toBe('ok');
		await sql`update form_assignments set ends_on = null where form_id = ${f.id}`;
		expect(await code(() => assignForm(who.hr, f.id, plan()))).toBe('too_many');
		await at(() => setFormStatus(who.hr, f.id, 'archived'));
	});

	it('hides assignments of archived forms', async () => {
		const f = await published('Old survey', [{ kind: 'text', label: 'Anything' }]);
		await at(() => assignForm(who.hr, f.id, plan()));
		expect((await due('ann')).map((d) => d.title)).toContain('Old survey');
		await at(() => setFormStatus(who.hr, f.id, 'archived'));
		expect((await due('ann')).map((d) => d.title)).not.toContain('Old survey');
		const [a] = await assignmentsOf(f.id);
		expect(await code(() => fillPage(who.ann, a.id))).toBe('not_found');
	});
});

describe('filling a form', () => {
	let form: Awaited<ReturnType<typeof published>>;
	let assignment = '';
	beforeAll(async () => {
		form = await published('Daily store check', [
			{ kind: 'number', label: 'Customers', required: 'on' },
			{ kind: 'multi', label: 'Issues', options: 'Lights\nDoor\nTill' },
			{ kind: 'photo', label: 'Shelf', required: 'on' },
			{ kind: 'file', label: 'Report' },
			{ kind: 'acknowledge', label: 'I checked the safe' }
		]);
		await at(() => assignForm(who.hr, form.id, plan({ schedule: 'daily', audience: 'branch', branchId: ids.dhaka })));
		assignment = (await assignmentsOf(form.id))[0].id;
	});
	const [customers, issues, shelf, report, ack] = [0, 1, 2, 3, 4];
	const answers = (over: [string, string | File][] = []) => {
		const d = fd([
			[form.fields[customers].id, '42'],
			[form.fields[issues].id, 'Door'],
			[form.fields[issues].id, 'Till'],
			[form.fields[shelf].id, png()],
			[form.fields[ack].id, 'on'],
			['lat', '23.81'],
			['lng', '90.41']
		]);
		for (const [k, v] of over) d.set(k, v);
		return d;
	};

	it('only opens for the people it is assigned to', async () => {
		expect(await code(() => fillPage(who.ann, assignment))).toBe('not_found');
		expect(await code(() => submitForm(who.ann, assignment, answers()))).toBe('not_found');
		expect(await code(() => fillPage(who.hr, assignment))).toBe('not_found');
		expect(await at(() => fillPage(who.bob, assignment))).toMatchObject({ period: TODAY, submitted: false });
	});

	it('checks answers, required files and photo type', async () => {
		expect(await code(() => submitForm(who.bob, assignment, answers([[form.fields[customers].id, 'many']])))).toBe(
			'invalid: Enter a number for "Customers".'
		);
		const noPhoto = answers();
		noPhoto.delete(form.fields[shelf].id);
		expect(await code(() => submitForm(who.bob, assignment, noPhoto))).toBe('missing_file');
		const pdfPhoto = answers();
		pdfPhoto.set(form.fields[shelf].id, pdf());
		expect(await code(() => submitForm(who.bob, assignment, pdfPhoto))).toBe('not_photo');
		expect(await code(() => submitForm(who.bob, assignment, answers([['lat', '123']])))).toMatch(/^invalid/);
		expect(await code(() => submitForm(who.bob, assignment, answers([[form.fields[customers].id, pdf()]])))).toMatch(
			/^invalid/
		);
		const sql = ownerPool().sql;
		expect(
			await sql`select 1 from files where tenant_id = ${tenant.id} and owner_type = 'form_submission'`
		).toHaveLength(0);
	});

	it('stores answers with files once per period', async () => {
		const id = await at(() => submitForm(who.bob, assignment, answers([[form.fields[report].id, pdf()]])));
		const [s] = await withTenant(sys(), (tx) => tx.select().from(formSubmissions).where(eq(formSubmissions.id, id)));
		expect(s).toMatchObject({ employeeId: ids.bob, period: TODAY, lat: 23.81, lng: 90.41 });
		expect(s.answers[form.fields[customers].id]).toBe(42);
		expect(s.answers[form.fields[issues].id]).toEqual(['Door', 'Till']);
		expect(s.answers[form.fields[ack].id]).toBe(true);
		const fileIds = [s.answers[form.fields[shelf].id], s.answers[form.fields[report].id]] as string[];
		expect(fileIds.every((x) => typeof x === 'string')).toBe(true);
		expect((await at(() => openFile(who.bob, fileIds[1]))).fileName).toBe('report.pdf');
		expect(await code(() => openFile(who.ann, fileIds[1]))).toBe('not_found');
		expect((await at(() => openFile(who.hr, fileIds[0]))).contentType).toBe('image/png');
		expect(await code(() => submitForm(who.bob, assignment, answers()))).toBe('already_submitted');
		expect(await at(() => fillPage(who.bob, assignment))).toMatchObject({ submitted: true });
		expect((await due('bob')).map((d) => d.title)).not.toContain('Daily store check');
		expect((await due('bob', '2026-12-08T03:30:00Z')).map((d) => d.title)).toContain('Daily store check');
	});

	it('asks once per form and period when assignments overlap', async () => {
		await at(() => assignForm(who.hr, form.id, plan({ schedule: 'daily' })));
		const other = (await assignmentsOf(form.id)).find((a) => a.audience === 'all')!;
		expect((await due('bob')).filter((d) => d.title === 'Daily store check')).toHaveLength(0);
		expect(await code(() => submitForm(who.bob, other.id, answers()))).toBe('already_submitted');
		const tomorrow = '2026-12-08T03:30:00Z';
		expect((await due('bob', tomorrow)).filter((d) => d.title === 'Daily store check')).toHaveLength(1);
		const blank = answers([
			['lat', ' '],
			['lng', ' ']
		]);
		const id = await at(() => submitForm(who.bob, other.id, blank), tomorrow);
		const [s] = await withTenant(sys(), (tx) => tx.select().from(formSubmissions).where(eq(formSubmissions.id, id)));
		expect(s).toMatchObject({ lat: null, lng: null, period: '2026-12-08' });
		expect(await code(() => submitForm(who.bob, assignment, answers()), tomorrow)).toBe('already_submitted');
		expect((await due('bob', tomorrow)).filter((d) => d.title === 'Daily store check')).toHaveLength(0);
		await withTenant(sys(), (tx) => tx.delete(formSubmissions).where(eq(formSubmissions.id, id)));
		await withTenant(sys(), (tx) => tx.delete(formAssignments).where(eq(formAssignments.id, other.id)));
	});

	it('shows the submission to HR with its files', async () => {
		const p = await page('hr', form.id);
		expect(p.submissions).toHaveLength(1);
		expect(p.submissions[0].files.map((f) => f.filename).sort()).toEqual(['report.pdf', 'shelf.png']);
		expect(p.assignments[0].target).toBe('Dhaka Shop');
		expect(await code(() => page('ann', form.id))).toBe('not_found');
	});

	it('keeps drafts away from readers', async () => {
		const draft = await at(() => createForm(who.hr, { title: 'Secret draft' }));
		expect(await code(() => page('mgr', draft))).toBe('not_found');
		expect((await page('hr', draft)).form.title).toBe('Secret draft');
	});
});

describe('reminders', () => {
	let assignment = '';
	beforeAll(async () => {
		const f = await published('Monday meeting notes', [{ kind: 'text', label: 'Notes', required: 'on' }]);
		await at(() =>
			assignForm(who.hr, f.id, plan({ schedule: 'weekly', weekday: '1', remindHour: '10', audience: 'all' }))
		);
		assignment = (await assignmentsOf(f.id))[0].id;
		await at(() => submitForm(who.ann, assignment, fd([[f.fields[0].id, 'Done']])));
	});
	const remind = (iso: string) => at(() => formReminders(tenant.id, tenant.slug), iso);
	const reminded = async (key: string) =>
		(await inbox(key)).filter((n) => n.link === `forms/fill/${assignment}`).length;

	it('reminds people who have not sent it, once, at the chosen hour', async () => {
		await remind('2026-12-07T03:10:00Z');
		expect(await reminded('bob')).toBe(0);
		await remind('2026-12-07T04:10:00Z');
		expect(await reminded('bob')).toBe(1);
		expect(await reminded('mgr')).toBe(1);
		expect(await reminded('ann')).toBe(0);
		await remind('2026-12-07T04:40:00Z');
		expect(await reminded('bob')).toBe(1);
		expect((await inbox('bob')).find((n) => n.link === `forms/fill/${assignment}`)).toMatchObject({
			category: 'forms',
			title: 'Form to fill: Monday meeting notes'
		});
	});

	it('only reminds weekly forms on their day', async () => {
		await remind('2026-12-08T04:10:00Z');
		expect(await reminded('bob')).toBe(1);
		await remind('2026-12-14T04:10:00Z');
		expect(await reminded('bob')).toBe(2);
		expect(await reminded('ann')).toBe(1);
	});

	it('reminds a once form for its first week only, and each person once across overlaps', async () => {
		const f = await published('Policy sign-off', [{ kind: 'acknowledge', label: 'I read the policy' }]);
		await at(() => assignForm(who.hr, f.id, plan({ remindHour: '11' })));
		await at(() => assignForm(who.hr, f.id, plan({ remindHour: '11', audience: 'employee', employeeId: ids.bob })));
		const links = (await assignmentsOf(f.id)).map((a) => `forms/fill/${a.id}`);
		const count = async () => (await inbox('bob')).filter((n) => links.includes(n.link ?? '')).length;
		await remind('2026-12-07T05:10:00Z');
		expect(await count()).toBe(1);
		await remind('2026-12-13T05:10:00Z');
		expect(await count()).toBe(2);
		await remind('2026-12-14T05:10:00Z');
		expect(await count()).toBe(2);
		expect((await due('bob', '2026-12-14T05:10:00Z')).map((d) => d.title)).toContain('Policy sign-off');
	});

	it('stays quiet when the module is off', async () => {
		await saveModules(
			sys(),
			MODULE_IDS.filter((m) => MODULES[m].on)
		);
		expect(await remind('2026-12-21T04:10:00Z')).toEqual([]);
		expect(await reminded('bob')).toBe(2);
		await saveModules(sys(), [...MODULE_IDS.filter((m) => MODULES[m].on), 'forms']);
	});
});

describe('form submissions scope', () => {
	it('shows each reader only the people in their scope', async () => {
		const world = await leakWorld(['form.read']);
		const sql = ownerPool().sql;
		const make = async (tenantId: string, employeeIds: string[]) => {
			const [f] = await sql<{ id: string }[]>`
				insert into forms (tenant_id, title, status, created_by_user_id)
				values (${tenantId}, 'Leak form', 'published', gen_random_uuid()) returning id`;
			const [a] = await sql<{ id: string }[]>`
				insert into form_assignments (tenant_id, form_id, audience, schedule, remind_hour, starts_on, created_by_user_id)
				values (${tenantId}, ${f.id}, 'all', 'once', 9, '2026-11-01', gen_random_uuid()) returning id`;
			for (const e of employeeIds)
				await sql`insert into form_submissions (tenant_id, form_id, assignment_id, employee_id, period, answers, submitted_by_user_id)
					values (${tenantId}, ${f.id}, ${a.id}, ${e}, '2026-11-01', '{}', gen_random_uuid())`;
			return f.id;
		};
		const home = await make(
			world.a.id,
			Object.values(world.emp).filter((e) => e !== world.emp.other)
		);
		const away = await make(world.b.id, [world.emp.other]);
		await expectScoped(world, async (m) => {
			const id = m.tenant.id === world.a.id ? home : away;
			const p = await withTenant(userCtx(m), (tx) => formPage(tx, m, id));
			return p.submissions.map((s) => s.employeeId);
		});
	});
});

describe('tasks', () => {
	const board = (key: string) => at(() => withTenant(userCtx(who[key]), (tx) => taskBoard(tx, who[key])));
	const task = (over: Record<string, string> = {}) => ({
		title: 'Restock shelf',
		description: '',
		assigneeEmployeeId: ids.ann,
		dueOn: '2026-12-09',
		...over
	});

	it('checks the task on the server', async () => {
		expect(await code(() => createTask(who.mgr, task({ title: ' ' })))).toBe('invalid: Give the task a title.');
		expect(await code(() => createTask(who.mgr, task({ dueOn: '2026-12-01' })))).toBe('past_due');
		expect(await code(() => createTask(who.mgr, task({ assigneeEmployeeId: ids.bob })))).toBe('bad_assignee');
		expect(await code(() => createTask(who.ann, task({ assigneeEmployeeId: ids.mgr })))).toBe('bad_assignee');
		expect(await code(() => createTask(who.hr, task({ assigneeEmployeeId: ids.gone })))).toBe('bad_assignee');
		expect(await code(() => createTask(who.hr, task({ assigneeEmployeeId: crypto.randomUUID() })))).toBe(
			'bad_assignee'
		);
	});

	it('gives a task to a report and tells them', async () => {
		await at(() => createTask(who.mgr, task()));
		expect((await inbox('ann')).filter((n) => n.category === 'tasks').map((n) => n.title)).toEqual([
			'New task: Restock shelf'
		]);
		expect((await board('ann')).mine.map((t) => t.title)).toEqual(['Restock shelf']);
		expect((await board('mgr')).given.map((t) => [t.title, t.assignee])).toEqual([['Restock shelf', 'Ann']]);
		expect((await board('mgr')).people.map((p) => p.name).sort()).toEqual(['Ann', 'Mia']);
		await at(() => createTask(who.ann, task({ title: 'Self note', assigneeEmployeeId: ids.ann, dueOn: '' })));
		expect((await inbox('ann')).filter((n) => n.category === 'tasks')).toHaveLength(1);
		expect((await board('ann')).mine.map((t) => t.title)).toEqual(['Restock shelf', 'Self note']);
	});

	it('lets the assignee or creator change status, and only the creator delete', async () => {
		const [t] = await withTenant(sys(), (tx) =>
			tx
				.select()
				.from(tasks)
				.where(and(eq(tasks.assigneeEmployeeId, ids.ann), eq(tasks.title, 'Restock shelf')))
		);
		expect(await code(() => setTaskStatus(who.bob, { taskId: t.id, done: 'true' }))).toBe('not_found');
		await at(() => setTaskStatus(who.ann, { taskId: t.id, done: 'true' }));
		const [done] = await withTenant(sys(), (tx) => tx.select().from(tasks).where(eq(tasks.id, t.id)));
		expect(done.status).toBe('done');
		expect(done.doneAt).not.toBeNull();
		await at(() => setTaskStatus(who.mgr, { taskId: t.id, done: 'false' }));
		expect((await withTenant(sys(), (tx) => tx.select().from(tasks).where(eq(tasks.id, t.id))))[0].doneAt).toBeNull();
		expect(await code(() => deleteTask(who.ann, { taskId: t.id }))).toBe('forbidden');
		expect(await code(() => deleteTask(who.bob, { taskId: t.id }))).toBe('not_found');
		await at(() => deleteTask(who.mgr, { taskId: t.id }));
		expect((await board('ann')).mine.map((t) => t.title)).toEqual(['Self note']);
	});
});
