import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTestNow } from '../../src/lib/server/clock';
import { closePools, ownerPool } from '../../src/lib/server/db';
import { memberships } from '../../src/lib/server/db/schema';
import { createEmployee, EMPLOYMENT_FIELDS, PROFILE_FIELDS } from '../../src/lib/server/employees';
import { MODULE_IDS, MODULES } from '../../src/lib/modules';
import { saveModules } from '../../src/lib/server/modules';
import { searchLimit } from '../../src/lib/server/ratelimit';
import { addMember, seedTenant } from '../../src/lib/server/platform/tenants';
import { loadAccess, userCtx, type requireMember } from '../../src/lib/server/rbac/access';
import { globalSearch, searchKinds, type SearchHit } from '../../src/lib/server/search';
import { systemCtx, withTenant } from '../../src/lib/server/tenancy';
import { createTenant, createUser, TEST_LOCALE } from './helpers';

type Member = ReturnType<typeof requireMember>;
type Viewer = { m: Member; active: boolean };
const NOW = '2026-11-26T06:00:00Z';
const who: Record<string, Viewer> = {};
const emp: Record<string, string> = {};
const rec: Record<string, string> = {};
let a: { id: string; slug: string };
let b: { id: string; slug: string };

const blanks = Object.fromEntries(Object.keys({ ...PROFILE_FIELDS, ...EMPLOYMENT_FIELDS }).map((k) => [k, '']));
const creator = {
	membershipId: '',
	employeeId: null,
	grants: { 'employee.read': ['all'], 'employee.create': ['all'], 'employee.update': ['all'] },
	roleKeys: [],
	isOwner: false
};
const hire = (tenantId: string, fullName: string, managerId = '') =>
	withTestNow(NOW, () =>
		createEmployee({ tenantId, actor: 'user' }, creator as never, {
			...blanks,
			fullName,
			managerId,
			employmentType: 'full_time',
			status: 'active',
			joinDate: '2026-01-01'
		})
	);

async function member(
	key: string,
	tenant: { id: string; slug: string },
	roleKeys: string[],
	employeeId: string | null,
	status = 'active'
) {
	const u = await createUser();
	const id = await withTenant(systemCtx(tenant.id), async (tx) => {
		const membershipId = await addMember(tx, tenant.id, u.id, roleKeys);
		await tx.update(memberships).set({ employeeId }).where(eq(memberships.id, membershipId));
		return membershipId;
	});
	who[key] = {
		active: status === 'active',
		m: {
			user: { userId: u.id },
			tenant: { id: tenant.id, slug: tenant.slug, name: tenant.slug },
			access: await loadAccess(tenant.id, { id, status, employeeId })
		} as unknown as Member
	};
}

const search = (key: string, q: string): Promise<SearchHit[]> =>
	withTestNow(NOW, () =>
		withTenant(userCtx(who[key].m), (tx) => globalSearch(tx, { access: who[key].m.access, active: who[key].active }, q))
	);
const titles = async (key: string, kind: string, q = 'zebra') =>
	(await search(key, q))
		.filter((h) => h.kind === kind)
		.map((h) => h.title)
		.sort();

const sql = () => ownerPool().sql;
const one = async (rows: Promise<{ id: string }[]>) => (await rows)[0].id;

beforeAll(async () => {
	a = await createTenant('sa');
	b = await createTenant('sb');
	await withTenant(systemCtx(a.id), (tx) => seedTenant(tx, a.id, TEST_LOCALE));
	await withTenant(systemCtx(b.id), (tx) => seedTenant(tx, b.id, TEST_LOCALE));

	emp.boss = await hire(a.id, 'Zebra Boss');
	emp.ana = await hire(a.id, 'Zebra Ana', emp.boss);
	emp.dee = await hire(a.id, 'Zebra Dee');
	emp.bob = await hire(a.id, 'Zebra Bob', emp.dee);
	emp.exy = await hire(a.id, 'Zebra Exy');
	emp.other = await hire(b.id, 'Zebra Other');

	await member('owner', a, ['owner'], null);
	await member('mgr', a, ['line_manager'], emp.boss);
	await member('ana', a, [], emp.ana);
	await member('bob', a, [], emp.bob);
	await member('rec', a, ['recruiter'], null);
	await member('ex', a, [], emp.exy, 'ex_employee');
	await member('other', b, ['owner'], emp.other);

	const role = await one(sql()`
		insert into roles (tenant_id, key, name) values (${a.id}, 'doc_reader', 'Doc reader') returning id`);
	await sql()`insert into role_permissions (tenant_id, role_id, permission, scope) values
		(${a.id}, ${role}, 'document.read', 'all'), (${a.id}, ${role}, 'employee.read', 'team')`;
	await member('docs', a, ['doc_reader'], emp.dee);

	const doc = (employeeId: string, title: string) => sql()`
		insert into employee_documents (tenant_id, employee_id, category, title, file_name, content_type, size_bytes, sha256, storage_key)
		values (${a.id}, ${employeeId}, 'certificate', ${title}, 'x.pdf', 'application/pdf', 1, 'x', ${`k/${title}`})`;
	await doc(emp.ana, 'Zebra degree Ana');
	await doc(emp.bob, 'Zebra degree Bob');

	const [tpl] = await sql()<{ id: string }[]>`select id from letter_templates where tenant_id = ${a.id} limit 1`;
	const letter = (n: number, employeeId: string, subject: string) => sql()`
		insert into letters (tenant_id, number, employee_id, template_id, kind, subject, body, file_name, size_bytes, sha256, storage_key, issued_on)
		values (${a.id}, ${n}, ${employeeId}, ${tpl.id}, 'experience', ${subject}, 'b', 'l.pdf', 1, 'x', ${`l/${n}`}, '2026-11-01')`;
	await letter(901, emp.ana, 'Zebra letter Ana');
	await letter(902, emp.bob, 'Zebra letter Bob');

	const policy = (title: string, active: boolean) => sql()`
		insert into policies (tenant_id, title, active, file_name, content_type, size_bytes, sha256, storage_key, published_on)
		values (${a.id}, ${title}, ${active}, 'p.pdf', 'application/pdf', 1, 'x', ${`p/${title}`}, '2026-11-01')`;
	await policy('Zebra handbook', true);
	await policy('Zebra draft policy', false);
	[{ id: rec.policy }] = await sql()<{ id: string }[]>`select id from policies where title = 'Zebra handbook'`;

	await sql()`insert into announcements (tenant_id, title, body, publish_on) values
		(${a.id}, 'Zebra party', 'b', '2026-11-20'), (${a.id}, 'Zebra future', 'b', '2026-12-20')`;
	await sql()`insert into events (tenant_id, title, location, start_date, end_date, audience) values
		(${a.id}, 'Zebra picnic', 'Park', '2026-12-05', '2026-12-05', 'all'),
		(${a.id}, 'Zebra retro', '', '2026-11-02', '2026-11-02', 'all')`;

	const plain = await one(sql()`
		insert into ticket_categories (tenant_id, name, sla_hours) values (${a.id}, 'Zebra IT', 8) returning id`);
	const secret = await one(sql()`
		insert into ticket_categories (tenant_id, name, sla_hours, confidential) values (${a.id}, 'Zebra HR', 8, true) returning id`);
	await sql()`insert into tickets (tenant_id, number, category_id, requester_employee_id, subject, description, sla_due_at) values
		(${a.id}, 7001, ${plain}, ${emp.bob}, 'Zebra laptop broken', 'd', now()),
		(${a.id}, 7002, ${secret}, ${emp.bob}, 'Zebra grievance', 'd', now())`;

	await sql()`insert into expense_claims (tenant_id, employee_id, title, status, total, submitted_by_user_id) values
		(${a.id}, ${emp.ana}, 'Zebra taxi Ana', 'submitted', 100, ${who.ana.m.user.userId}),
		(${a.id}, ${emp.bob}, 'Zebra taxi Bob', 'submitted', 100, ${who.bob.m.user.userId})`;

	const asset = await one(sql()`
		insert into assets (tenant_id, tag, name, category, status) values (${a.id}, 'ZEB-1', 'Zebra laptop', 'IT', 'assigned') returning id`);
	await sql()`insert into assets (tenant_id, tag, name, category) values (${a.id}, 'ZEB-2', 'Zebra monitor', 'IT')`;
	await sql()`insert into asset_assignments (tenant_id, asset_id, employee_id, assigned_on, condition_out)
		values (${a.id}, ${asset}, ${emp.ana}, '2026-11-01', 'good')`;

	const project = await one(sql()`
		insert into projects (tenant_id, code, name) values (${a.id}, 'ZEB', 'Zebra app') returning id`);
	await sql()`insert into projects (tenant_id, code, name) values (${a.id}, 'ZEC', 'Zebra site')`;
	await sql()`insert into project_members (tenant_id, project_id, employee_id) values (${a.id}, ${project}, ${emp.ana})`;

	const opening = await one(sql()`
		insert into job_openings (tenant_id, title) values (${a.id}, 'Zebra engineer') returning id`);
	const stage = await one(sql()`
		insert into pipeline_stages (tenant_id, opening_id, name, sort_order) values (${a.id}, ${opening}, 'Applied', 1) returning id`);
	await sql()`insert into candidates (tenant_id, opening_id, stage_id, full_name, email)
		values (${a.id}, ${opening}, ${stage}, 'Zebra Candidate', 'zebra.cand@example.com')`;

	await sql()`insert into payroll_runs (tenant_id, run_type, title, period, inputs_hash, output_hash, computed_by_user_id, computed_at)
		values (${a.id}, 'bonus', 'Zebra bonus', '2026-10', 'i', 'o', ${who.owner.m.user.userId}, now())`;

	await saveModules(systemCtx(a.id), [...MODULE_IDS.filter((id) => MODULES[id].on), 'learning']);
	await sql()`insert into kb_articles (tenant_id, title, status) values (${a.id}, 'Zebra how-to', 'published')`;
	await sql()`insert into courses (tenant_id, title, status) values
		(${a.id}, 'Zebra safety', 'published'), (${a.id}, 'Zebra draft course', 'draft')`;
});

afterAll(closePools);

describe('global search visibility', () => {
	it('finds people only inside the viewer employee scope and tenant', async () => {
		expect(await titles('ana', 'employee')).toEqual(['Zebra Ana']);
		expect(await titles('mgr', 'employee')).toEqual(['Zebra Ana', 'Zebra Boss']);
		expect(await titles('owner', 'employee')).toEqual([
			'Zebra Ana',
			'Zebra Bob',
			'Zebra Boss',
			'Zebra Dee',
			'Zebra Exy'
		]);
		expect(await titles('other', 'employee')).toEqual(['Zebra Other']);
	});

	it('requires both employee and document scope for documents', async () => {
		expect(await titles('ana', 'document')).toEqual(['Zebra degree Ana']);
		expect(await titles('mgr', 'document')).toEqual([]);
		expect(await titles('docs', 'document')).toEqual(['Zebra degree Bob']);
		expect(await titles('owner', 'document')).toEqual(['Zebra degree Ana', 'Zebra degree Bob']);
	});

	it('shows own letters plus letters in the issue scope', async () => {
		expect(await titles('ana', 'letter')).toEqual(['#901 Zebra letter Ana']);
		expect(await titles('owner', 'letter')).toEqual(['#901 Zebra letter Ana', '#902 Zebra letter Bob']);
		for (const q of ['902', '#902'])
			expect((await search('owner', q)).filter((h) => h.kind === 'letter').map((h) => h.title)).toEqual([
				'#902 Zebra letter Bob'
			]);
	});

	it('hides inactive policies from staff and links them to the file, not the manager page', async () => {
		const staff = (await search('ana', 'zebra')).filter((h) => h.kind === 'policy');
		expect(staff.map((h) => [h.title, h.href])).toEqual([['Zebra handbook', `policies/${rec.policy}/file`]]);
		const manager = (await search('owner', 'zebra')).filter((h) => h.kind === 'policy');
		expect(manager.map((h) => h.title).sort()).toEqual(['Zebra draft policy', 'Zebra handbook']);
		expect(manager.find((h) => h.title === 'Zebra handbook')?.href).toBe(`policies/${rec.policy}`);
	});

	it('shows only live announcements to staff', async () => {
		expect(await titles('ana', 'announcement')).toEqual(['Zebra party']);
		expect(await titles('owner', 'announcement')).toEqual(['Zebra future', 'Zebra party']);
	});

	it('shows staff upcoming events and managers recent ones too', async () => {
		expect(await titles('ana', 'event')).toEqual(['Zebra picnic']);
		expect(await titles('owner', 'event')).toEqual(['Zebra picnic', 'Zebra retro']);
		expect(await titles('ana', 'event', 'park')).toEqual(['Zebra picnic']);
	});

	it('never matches a confidential ticket by subject and masks it when found by number', async () => {
		expect(await titles('ana', 'ticket')).toEqual([]);
		expect(await titles('bob', 'ticket')).toEqual(['#7001 Zebra laptop broken']);
		expect(await titles('owner', 'ticket')).toEqual(['#7001 Zebra laptop broken']);
		expect(await titles('bob', 'ticket', '#7002')).toEqual(['Confidential ticket #7002']);
		expect(await titles('ana', 'ticket', '7002')).toEqual([]);
	});

	it('mirrors the expense board: own claims and claims waiting in the approve scope', async () => {
		expect(await titles('ana', 'expense')).toEqual(['Zebra taxi Ana']);
		expect(await titles('mgr', 'expense')).toEqual(['Zebra taxi Ana']);
		expect(await titles('bob', 'expense')).toEqual(['Zebra taxi Bob']);
	});

	it('limits assets and projects to the ones the viewer holds or works on', async () => {
		expect(await titles('ana', 'asset')).toEqual(['ZEB-1 Zebra laptop']);
		expect(await titles('bob', 'asset')).toEqual([]);
		expect(await titles('owner', 'asset')).toEqual(['ZEB-1 Zebra laptop', 'ZEB-2 Zebra monitor']);
		expect(await titles('ana', 'project')).toEqual(['ZEB Zebra app']);
		expect(await titles('bob', 'project')).toEqual([]);
	});

	it('keeps recruitment and payroll to the people who hold those permissions', async () => {
		expect(await titles('rec', 'opening')).toEqual(['Zebra engineer']);
		expect(await titles('rec', 'candidate')).toEqual(['Zebra Candidate']);
		expect(await titles('ana', 'opening')).toEqual([]);
		expect(await titles('ana', 'candidate')).toEqual([]);
		expect(await titles('owner', 'payroll')).toEqual(['Zebra bonus']);
		expect(await titles('rec', 'payroll')).toEqual([]);
		expect(await titles('ana', 'payroll')).toEqual([]);
	});

	it('shows staff published courses and course managers the drafts too', async () => {
		expect(await titles('ana', 'course')).toEqual(['Zebra safety']);
		expect(await titles('owner', 'course')).toEqual(['Zebra draft course', 'Zebra safety']);
		expect(await titles('ex', 'course')).toEqual([]);
	});

	it('gives an ex-employee only their own record and nothing that needs an active membership', async () => {
		const kinds = new Set((await search('ex', 'zebra')).map((h) => h.kind));
		expect(kinds.has('policy') || kinds.has('announcement') || kinds.has('event')).toBe(false);
		expect(await titles('ex', 'employee')).toEqual(['Zebra Exy']);
	});

	it('never returns another tenant record', async () => {
		const hits = await search('other', 'zebra');
		expect(hits.map((h) => h.title)).toEqual(['Zebra Other']);
	});

	it('treats LIKE wildcards literally and enforces the query length', async () => {
		expect(await search('owner', '%%')).toEqual([]);
		expect(await search('owner', '__')).toEqual([]);
		await expect(search('owner', 'z')).rejects.toThrow();
		await expect(search('owner', 'z'.repeat(81))).rejects.toThrow();
		await expect(search('owner', 'ze\u0000bra')).rejects.toThrow();
	});

	it('ranks an exact code match first and has a case for every provider', async () => {
		expect((await search('owner', 'ZEB-2'))[0]?.title).toBe('ZEB-2 Zebra monitor');
		const covered = new Set((await search('owner', 'zebra')).map((h) => h.kind));
		for (const kind of searchKinds().filter((k) => k !== 'candidate' && k !== 'opening'))
			expect(covered).toContain(kind);
		const recruiter = new Set((await search('rec', 'zebra')).map((h) => h.kind));
		expect(recruiter).toContain('candidate');
		expect(recruiter).toContain('opening');
	});
	it('links every hit to a route that exists', async () => {
		const root = join(process.cwd(), 'src/routes/t/[slug]');
		const resolve = (href: string) => {
			let dir = root;
			for (const seg of href.split('?')[0].split('/')) {
				const next = existsSync(join(dir, seg))
					? seg
					: readdirSync(dir).find((d) => d.startsWith('[') && !d.startsWith('[...'));
				if (!next) return false;
				dir = join(dir, next);
			}
			return existsSync(join(dir, '+page.server.ts')) || existsSync(join(dir, '+server.ts'));
		};
		const hits = [
			...(await search('owner', 'zebra')),
			...(await search('ana', 'zebra')),
			...(await search('rec', 'zebra'))
		];
		const broken = hits.filter((h) => !resolve(h.href)).map((h) => `${h.kind} ${h.href}`);
		expect(broken).toEqual([]);
	});

	it('rate limits searches per membership', async () => {
		const id = crypto.randomUUID();
		for (let i = 0; i < 60; i++) expect(await searchLimit(id)).toBeNull();
		expect((await searchLimit(id))?.status).toBe(429);
	});
});
