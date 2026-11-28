import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MODULE_IDS, MODULES } from '../../src/lib/modules';
import { closePools, ownerPool } from '../../src/lib/server/db';
import { memberships } from '../../src/lib/server/db/schema';
import { createEmployee, EMPLOYMENT_FIELDS, PROFILE_FIELDS } from '../../src/lib/server/employees';
import { ME, myActivity, myDetails, myRequests } from '../../src/lib/server/me';
import { saveModules } from '../../src/lib/server/modules';
import { addMember, seedTenant } from '../../src/lib/server/platform/tenants';
import { loadAccess, userCtx, type requireMember } from '../../src/lib/server/rbac/access';
import { systemCtx, withTenant } from '../../src/lib/server/tenancy';
import { createTenant, createUser, TEST_LOCALE } from './helpers';

type Member = ReturnType<typeof requireMember>;
type Tenant = { id: string; slug: string };
let a: Tenant;
let b: Tenant;
const ids: Record<string, string> = {};
const who: Record<string, Member> = {};
const blanks = Object.fromEntries(Object.keys({ ...PROFILE_FIELDS, ...EMPLOYMENT_FIELDS }).map((k) => [k, '']));
const creator = {
	membershipId: '',
	employeeId: null,
	grants: { 'employee.read': ['all'], 'employee.create': ['all'], 'employee.update': ['all'] },
	roleKeys: [],
	isOwner: false
};
const hire = (t: Tenant, fullName: string, managerId = '') =>
	createEmployee({ tenantId: t.id, actor: 'user' }, creator as never, {
		...blanks,
		fullName,
		managerId,
		employmentType: 'full_time',
		status: 'active',
		joinDate: '2026-01-01'
	});

async function member(t: Tenant, key: string, userId: string, employeeId: string | null) {
	const id = await withTenant(systemCtx(t.id), async (tx) => {
		const membershipId = await addMember(tx, t.id, userId, ['employee']);
		await tx.update(memberships).set({ employeeId }).where(eq(memberships.id, membershipId));
		return membershipId;
	});
	who[key] = {
		user: { userId },
		tenant: { id: t.id, slug: t.slug, name: t.slug },
		access: await loadAccess(t.id, { id, status: 'active', employeeId })
	} as unknown as Member;
}

const as = <T>(key: string, fn: (tx: Parameters<Parameters<typeof withTenant>[1]>[0], m: Member) => Promise<T>) =>
	withTenant(userCtx(who[key]), (tx) => fn(tx, who[key]));

async function seedRequests(t: Tenant, employeeId: string, userId: string, tag: string) {
	const sql = ownerPool().sql;
	const [type] = await sql<{ id: string }[]>`select id from leave_types where tenant_id = ${t.id} limit 1`;
	await sql`insert into leave_requests (tenant_id, employee_id, leave_type_id, start_date, end_date, session, days, requested_by_user_id)
		values (${t.id}, ${employeeId}, ${type.id}, '2026-12-10', '2026-12-11', 'full', 2, ${userId})`;
	await sql`insert into attendance_requests (tenant_id, employee_id, kind, date, reason, requested_by_user_id)
		values (${t.id}, ${employeeId}, 'wfh', '2026-12-09', 'Plumber', ${userId})`;
	await sql`insert into expense_claims (tenant_id, employee_id, title, total, submitted_by_user_id)
		values (${t.id}, ${employeeId}, ${`Taxi ${tag}`}, 500, ${userId})`;
	await sql`insert into loans (tenant_id, employee_id, kind, amount, instalments, start_period, reason, requested_by_user_id)
		values (${t.id}, ${employeeId}, 'advance', 1000, 1, '2026-12', ${`Rent ${tag}`}, ${userId})`;
	const [cat] = await sql<{ id: string }[]>`
		insert into ticket_categories (tenant_id, name, sla_hours) values (${t.id}, ${`IT ${tag}`}, 24)
		on conflict do nothing returning id`;
	const [n] = await sql<
		{ n: number }[]
	>`select coalesce(max(number), 0) + 1 as n from tickets where tenant_id = ${t.id}`;
	await sql`insert into tickets (tenant_id, number, category_id, requester_employee_id, subject, description, sla_due_at)
		values (${t.id}, ${n.n}, ${cat.id}, ${employeeId}, ${`Laptop ${tag}`}, 'Broken', now() + interval '1 day')`;
	await sql`insert into travel_requests (tenant_id, employee_id, purpose, country, depart_on, return_on, estimated_cost, requested_by_user_id)
		values (${t.id}, ${employeeId}, ${`Workshop ${tag}`}, 'India', '2027-01-01', '2027-01-02', 100, ${userId})`;
}

beforeAll(async () => {
	a = await createTenant('mea');
	b = await createTenant('meb');
	await withTenant(systemCtx(a.id), (tx) => seedTenant(tx, a.id, TEST_LOCALE));
	await withTenant(systemCtx(b.id), (tx) => seedTenant(tx, b.id, TEST_LOCALE));
	ids.mgr = await hire(a, 'Mia');
	ids.ann = await hire(a, 'Ann', ids.mgr);
	ids.bob = await hire(a, 'Bob');
	ids.annB = await hire(b, 'Ann Elsewhere');
	const ann = await createUser();
	const bob = await createUser();
	const nobody = await createUser();
	await member(a, 'ann', ann.id, ids.ann);
	await member(a, 'bob', bob.id, ids.bob);
	await member(a, 'nobody', nobody.id, null);
	await member(b, 'annB', ann.id, ids.annB);
	await seedRequests(a, ids.ann, ann.id, 'ann');
	await seedRequests(a, ids.bob, bob.id, 'bob');
	await seedRequests(b, ids.annB, ann.id, 'elsewhere');
});

afterAll(closePools);

describe('details', () => {
	it('shows the person their own record with names, not ids', async () => {
		expect(await as('ann', myDetails)).toMatchObject({
			id: ids.ann,
			fullName: 'Ann',
			manager: 'Mia',
			status: 'active'
		});
		expect(await as('nobody', myDetails)).toBeNull();
	});
});

describe('my requests', () => {
	const labels = async (key: string) =>
		Object.fromEntries((await as(key, myRequests)).map((g) => [g.key, g.items.map((i) => i.label)]));

	it('lists only the person’s own requests, per module, newest first', async () => {
		expect(await labels('ann')).toEqual({
			leave: [expect.stringMatching(/, 2026-12-10 to 2026-12-11$/)],
			attendance: ['Work from home on 2026-12-09'],
			expenses: ['Taxi ann'],
			loans: ['Salary advance: Rent ann'],
			helpdesk: ['Laptop ann']
		});
		const [ticket] = (await as('ann', myRequests)).find((g) => g.key === 'helpdesk')!.items;
		expect(ticket.link).toBe(`helpdesk/${ticket.id}`);
		expect(await as('nobody', myRequests)).toEqual([]);
	});

	it('adds trips and forms only while their modules are on', async () => {
		await saveModules(systemCtx(a.id), [...MODULE_IDS.filter((m) => MODULES[m].on), 'travel', 'forms']);
		const l = await labels('ann');
		expect(l.travel).toEqual(['Workshop ann']);
		expect(l.forms).toEqual([]);
		await saveModules(
			systemCtx(a.id),
			MODULE_IDS.filter((m) => MODULES[m].on)
		);
		expect(Object.keys(await labels('ann'))).not.toContain('travel');
	});

	it('shows only the modules the person may open, with dates in the company time zone', async () => {
		const sql = ownerPool().sql;
		const [role] = await sql<{ id: string }[]>`
			insert into roles (tenant_id, key, name) values (${a.id}, 'me_leave_only', 'Leave only') returning id`;
		await sql`insert into role_permissions (tenant_id, role_id, permission, scope) values (${a.id}, ${role.id}, 'leave.request', 'own')`;
		const cy = await hire(a, 'Cy');
		const u = await createUser();
		const id = await withTenant(systemCtx(a.id), async (tx) => {
			const membershipId = await addMember(tx, a.id, u.id, ['me_leave_only']);
			await tx.update(memberships).set({ employeeId: cy }).where(eq(memberships.id, membershipId));
			return membershipId;
		});
		await sql`delete from membership_roles where membership_id = ${id}
			and role_id = (select id from roles where tenant_id = ${a.id} and key = 'employee')`;
		who.cy = {
			user: { userId: u.id },
			tenant: { id: a.id, slug: a.slug, name: a.slug },
			access: await loadAccess(a.id, { id, status: 'active', employeeId: cy })
		} as unknown as Member;
		await seedRequests(a, cy, u.id, 'cy');
		await sql`update leave_requests set created_at = '2026-12-01T20:00:00Z' where employee_id = ${cy}`;
		const groups = await as('cy', myRequests);
		expect(groups.map((g) => g.key)).toEqual(['leave']);
		expect(groups[0].items[0].on).toBe('2026-12-02');
		expect((await as('cy', myDetails))?.canOpen).toBe(false);
		expect((await as('ann', myDetails))?.canOpen).toBe(true);
	});

	it('caps each module at its newest entries', async () => {
		const sql = ownerPool().sql;
		for (let i = 0; i < ME.perModule + 3; i++)
			await sql`insert into expense_claims (tenant_id, employee_id, title, total, submitted_by_user_id, created_at)
				values (${a.id}, ${ids.bob}, ${`Bulk ${i}`}, 1, gen_random_uuid(), now() + make_interval(mins => ${i}))`;
		const items = (await as('bob', myRequests)).find((g) => g.key === 'expenses')!.items;
		expect(items).toHaveLength(ME.perModule);
		expect(items[0].label).toBe(`Bulk ${ME.perModule + 2}`);
	});
});

describe('activity', () => {
	const sql = () => ownerPool().sql;
	const log = (t: Tenant, actor: string, table: string, i: number, op = 'UPDATE', event: string | null = null) =>
		sql()`insert into audit_log (tenant_id, actor_user_id, actor_kind, table_name, row_id, op, changed_columns, old_values, new_values, event, created_at)
			values (${t.id}, ${actor}, 'user', ${table}, gen_random_uuid(), ${op}, '{full_name}', '{"full_name":"Old secret"}', '{"full_name":"New secret"}', ${event}, ${`2026-12-01T00:00:00Z`}::timestamptz + make_interval(secs => ${i}))`;

	beforeAll(async () => {
		const ann = who.ann.user.userId;
		await sql()`delete from audit_log where tenant_id in (${a.id}, ${b.id})`;
		for (let i = 0; i < ME.activity + 5; i++) await log(a, ann, 'leave_requests', i);
		await log(a, ann, 'files', 100, 'INSERT', 'file.download');
		await log(a, ann, 'employees', 98, 'READ', 'employee.export');
		await log(a, ann, 'employees', 99, 'READ', 'something.new');
		await log(a, ann, 'survey_responses', 101, 'INSERT');
		await log(a, ann, 'salary_changes', 102, 'INSERT');
		await log(a, who.bob.user.userId, 'leave_requests', 103);
		await log(b, ann, 'leave_requests', 104);
	});

	it('pages through the person’s own whitelisted rows without values', async () => {
		const first = await as('ann', (tx, m) => myActivity(tx, m));
		expect(first.entries).toHaveLength(ME.activity);
		expect(first.entries[0]).toMatchObject({ what: 'File', action: 'Downloaded' });
		expect(first.entries[1]).toMatchObject({ what: 'Employee record', action: 'Opened' });
		expect(first.entries[2]).toMatchObject({ what: 'Employee record', action: 'Exported' });
		expect(first.entries[3]).toMatchObject({ what: 'Leave request', action: 'Changed' });
		expect(first.entries[0].at).toBe('2026-12-01 06:01');
		expect(JSON.stringify(first)).not.toContain('secret');
		expect(Object.keys(first.entries[0]).sort()).toEqual(['action', 'at', 'id', 'what']);
		const second = await as('ann', (tx, m) => myActivity(tx, m, first.next));
		expect(second.entries).toHaveLength(8);
		expect(second.next).toBeNull();
		const all = [...first.entries, ...second.entries];
		expect(new Set(all.map((e) => e.id)).size).toBe(ME.activity + 8);
		expect(all.map((e) => e.what)).not.toContain(undefined);
	});

	it('ignores other people’s rows, other tenants and bad cursors', async () => {
		const bob = await as('bob', (tx, m) => myActivity(tx, m));
		expect(bob.entries).toHaveLength(1);
		const elsewhere = await as('annB', (tx, m) => myActivity(tx, m));
		expect(elsewhere.entries).toHaveLength(1);
		for (const stale of [bob.entries[0].id, crypto.randomUUID(), elsewhere.entries[0].id])
			expect((await as('ann', (tx, m) => myActivity(tx, m, stale))).entries).toHaveLength(ME.activity);
		expect((await as('ann', (tx, m) => myActivity(tx, m, 'nope'))).entries).toHaveLength(ME.activity);
	});
});
