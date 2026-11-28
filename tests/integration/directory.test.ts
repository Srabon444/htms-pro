import { and, eq, sql as drizzleSql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTestNow } from '../../src/lib/server/clock';
import { closePools, ownerPool } from '../../src/lib/server/db';
import { notifications } from '../../src/lib/server/db/schema';
import {
	celebrations,
	chartChildren,
	chartPathTo,
	chartStart,
	departmentLevel,
	listDirectory,
	notifyCelebrations,
	setShowBirthday,
	weekCelebrations
} from '../../src/lib/server/directory';
import { modulesOn, saveModules } from '../../src/lib/server/modules';
import { userCtx } from '../../src/lib/server/rbac/access';
import { systemCtx, withTenant, type Tx } from '../../src/lib/server/tenancy';
import { seedTenant } from '../../src/lib/server/platform/tenants';
import { createTenant, TEST_LOCALE } from './helpers';
import { expectScoped, hire, leakWorld, type LeakWorld, type Member } from './leak';

let w: LeakWorld;
const extra: Record<string, string> = {};
const sql = () => ownerPool().sql;
const as = <T>(m: Member, fn: (tx: Tx) => Promise<T>) => withTestNow(w.now, () => withTenant(userCtx(m), fn));
const inA = <T>(fn: (tx: Tx) => Promise<T>) => withTenant(systemCtx(w.a.id), fn);
const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort();

beforeAll(async () => {
	w = await leakWorld(['directory.read', 'employee.read']);
	extra.gone = await hire(w.a.id, 'Leak Gone');
	extra.fresh = await hire(w.a.id, 'Leak Fresh');
	extra.late = await hire(w.a.id, 'Leak Late', extra.gone);
	extra.x = await hire(w.a.id, 'Leak Loop X');
	extra.y = await hire(w.a.id, 'Leak Loop Y', extra.x);
	await sql()`update employees set status = 'exited', exit_date = '2026-06-01' where id = ${extra.gone}`;
	await sql()`update employees set status = 'onboarding' where id = ${extra.fresh}`;
	await sql()`update employees set manager_id = ${extra.y} where id = ${extra.x}`;
	await sql()`update employees set join_date = '2020-02-29' where id = ${w.emp.boss}`;
	await sql()`update employees set date_of_birth = '1992-02-29', show_birthday = true where id = ${w.emp.ana}`;
	await sql()`update employees set date_of_birth = '1991-02-28' where id = ${w.emp.bob}`;
});

afterAll(closePools);

describe('directory list', () => {
	it('lists current staff of the viewer organisation only', async () => {
		const current = [w.emp.boss, w.emp.ana, w.emp.dee, w.emp.bob, extra.late, extra.x, extra.y].sort();
		for (const key of ['own', 'team', 'department', 'all'] as const)
			expect(ids((await as(w.viewers[key], (tx) => listDirectory(tx, w.viewers[key].access, {}))).rows), key).toEqual(
				current
			);
		expect(
			ids((await as(w.viewers.otherTenant, (tx) => listDirectory(tx, w.viewers.otherTenant.access, {}))).rows)
		).toEqual([w.emp.other]);
	});

	it('links to a profile only inside the viewer employee scope', () =>
		expectScoped(w, async (m) => {
			const known = new Set(Object.values(w.emp));
			const { rows } = await as(m, (tx) => listDirectory(tx, m.access, {}));
			return rows.filter((r) => r.canOpen && known.has(r.id)).map((r) => r.id);
		}));

	it('searches by department name', async () => {
		const { rows, total } = await as(w.viewers.own, (tx) => listDirectory(tx, w.viewers.own.access, { q: 'leak ops' }));
		expect(ids(rows)).toEqual([w.emp.dee, w.emp.bob].sort());
		expect(total).toBe(2);
		expect((await as(w.viewers.own, (tx) => listDirectory(tx, w.viewers.own.access, { q: 'Leak\0 Ops' }))).total).toBe(
			2
		);
	});
});

describe('birthdays', () => {
	it('stay hidden and cannot be switched on while the module is off', async () => {
		await setShowBirthday(userCtx(w.viewers.team), w.viewers.team.access, true);
		const list = await as(w.viewers.own, (tx) => listDirectory(tx, w.viewers.own.access, {}));
		expect(list.birthdays).toBe(false);
		expect(list.showBirthday).toBeNull();
		expect(list.rows.every((r) => r.birthday === null)).toBe(true);
		const [boss] = await sql()<
			{ show_birthday: boolean }[]
		>`select show_birthday from employees where id = ${w.emp.boss}`;
		expect(boss.show_birthday).toBe(false);
	});

	it('show day and month only for people who opted in once the module is on', async () => {
		await saveModules(systemCtx(w.a.id), ['directory', 'celebrations_birthdays']);
		const list = await as(w.viewers.own, (tx) => listDirectory(tx, w.viewers.own.access, {}));
		expect(list.showBirthday).toBe(true);
		const byId = Object.fromEntries(list.rows.map((r) => [r.id, r.birthday]));
		expect(byId[w.emp.ana]).toBe('02-29');
		expect(byId[w.emp.bob]).toBeNull();
	});
});

describe('org chart', () => {
	it('starts from people without a current manager and loads one level', async () => {
		const start = await as(w.viewers.own, chartStart);
		expect(ids(start.roots)).toEqual([w.emp.boss, w.emp.dee, extra.late].sort());
		expect(start.roots.find((r) => r.id === w.emp.boss)!.reports).toBe(1);
		expect(ids(start.children)).toEqual([w.emp.ana, w.emp.bob].sort());
		expect(ids(await as(w.viewers.own, (tx) => chartChildren(tx, [extra.gone])))).toEqual([extra.late]);
	});

	it('walks up to the top for find me and stops on a reporting loop', async () => {
		const path = await as(w.viewers.own, (tx) => chartPathTo(tx, w.emp.ana));
		expect(path.chain).toEqual([w.emp.boss, w.emp.ana]);
		expect(ids(path.children)).toEqual([w.emp.ana]);
		const loop = await as(w.viewers.own, (tx) => chartPathTo(tx, extra.x));
		expect(loop.chain.sort()).toEqual([extra.x, extra.y].sort());
		expect((await as(w.viewers.own, (tx) => chartPathTo(tx, extra.gone))).chain).toEqual([]);
	});

	it('groups by department', async () => {
		const top = await as(w.viewers.own, (tx) => departmentLevel(tx, null));
		const ops = top.departments.find((d) => d.name === 'Leak Ops')!;
		expect(ops.people).toBe(2);
		expect(ids((await as(w.viewers.own, (tx) => departmentLevel(tx, ops.id))).people)).toEqual(
			[w.emp.dee, w.emp.bob].sort()
		);
	});
});

describe('celebrations', () => {
	it('moves 29 February to the 28th in other years and counts anniversary years', async () => {
		const week = await inA((tx) => celebrations(tx, '2026-02-25', 7, true));
		expect(week.map((c) => [c.date, c.kind, c.name, c.years])).toEqual([
			['2026-02-28', 'birthday', 'Leak Ana', null],
			['2026-02-28', 'anniversary', 'Leak Boss', 6]
		]);
		expect((await inA((tx) => celebrations(tx, '2026-02-25', 7, false))).map((c) => c.kind)).toEqual(['anniversary']);
		const leap = await inA((tx) => celebrations(tx, '2028-02-29', 1, true));
		expect(leap.map((c) => c.name)).toEqual(['Leak Ana', 'Leak Boss']);
	});

	it('skips the first year and people who are not current staff', async () => {
		expect((await inA((tx) => celebrations(tx, '2026-01-01', 1, true))).map((c) => c.name)).toEqual([]);
		const next = await inA((tx) => celebrations(tx, '2027-01-01', 1, true));
		expect(next.map((c) => c.name)).not.toContain('Leak Gone');
		expect(next.find((c) => c.name === 'Leak Dee')?.years).toBe(1);
	});

	it('tells the manager once a day', async () => {
		const run = () => withTestNow('2026-02-28T09:00:00Z', () => notifyCelebrations(w.a.id, w.a.slug));
		const audited = async () =>
			(
				await sql()<{ n: number }[]>`
				select count(*)::int as n from audit_log where tenant_id = ${w.a.id} and table_name = 'tenant_settings'`
			)[0].n;
		const before = await audited();
		await run();
		await run();
		expect(await audited()).toBe(before);
		const rows = await withTenant(systemCtx(w.a.id), (tx) =>
			tx
				.select({ body: notifications.body })
				.from(notifications)
				.where(
					and(
						eq(notifications.membershipId, w.viewers.team.access.membershipId),
						eq(notifications.category, 'celebrations')
					)
				)
		);
		expect(rows).toEqual([{ body: 'Leak Ana: birthday' }]);
	});
});

describe('module toggles', () => {
	it('turn the directory off and reject unknown modules', async () => {
		await saveModules(systemCtx(w.a.id), ['celebrations_birthdays']);
		expect([...(await inA(modulesOn))]).toEqual(['celebrations_birthdays']);
		expect(await inA((tx) => weekCelebrations(tx, '2026-02-25'))).toBeNull();
		const [s] = await sql()<{ e: string[]; d: string[] }[]>`
			select modules_enabled as e, modules_disabled as d from tenant_settings where tenant_id = ${w.a.id}`;
		expect(s).toEqual({
			e: ['celebrations_birthdays'],
			d: ['directory', 'calendar', 'events', 'schedule', 'surveys', 'kudos', 'knowledge']
		});
		await expect(saveModules(systemCtx(w.a.id), ['payroll'])).rejects.toThrow();
		await saveModules(systemCtx(w.a.id), ['directory', 'calendar', 'events']);
		expect([...(await inA(modulesOn))]).toEqual(['directory', 'calendar', 'events']);
	});
});

describe('org chart at size', () => {
	it('caps each level at 200, says how many there are, and still finds people past the cap', async () => {
		const wide = await createTenant('wide');
		await withTenant(systemCtx(wide.id), (tx) => seedTenant(tx, wide.id, TEST_LOCALE));
		const [dept] = await sql()<{ id: string }[]>`
			insert into departments (tenant_id, name) values (${wide.id}, 'Wide') returning id`;
		const [boss] = await sql()<{ id: string }[]>`
			insert into employees (tenant_id, code, full_name, employment_type, status, join_date, department_id)
			values (${wide.id}, 'M', 'Aaa Boss', 'full_time', 'active', '2020-01-01', ${dept.id}) returning id`;
		await sql()`insert into employees (tenant_id, code, full_name, employment_type, status, join_date, manager_id, department_id)
			select ${wide.id}, 'E' || g, 'Emp ' || lpad(g::text, 4, '0'), 'full_time', 'active', '2020-01-01', ${boss.id}, ${dept.id}
			from generate_series(1, 300) g`;
		await sql()`insert into employees (tenant_id, code, full_name, employment_type, status, join_date)
			select ${wide.id}, 'R' || g, 'Zz Root ' || lpad(g::text, 4, '0'), 'full_time', 'active', '2020-01-01'
			from generate_series(1, 250) g`;
		const one = async (code: string) =>
			(await sql()<{ id: string }[]>`select id from employees where tenant_id = ${wide.id} and code = ${code}`)[0].id;
		const [deep, lastRoot] = [await one('E250'), await one('R250')];
		const inWide = <T>(fn: (tx: Tx) => Promise<T>) => withTenant(systemCtx(wide.id), fn);

		const start = await inWide(chartStart);
		expect([start.roots.length, start.roots[0].siblings]).toEqual([200, 251]);
		expect([start.children.length, start.children[0].siblings]).toEqual([200, 300]);
		const unit = await inWide((tx) => departmentLevel(tx, dept.id));
		expect([unit.people.length, unit.people[0].siblings]).toEqual([200, 301]);

		const path = await inWide((tx) => chartPathTo(tx, deep));
		expect(path.chain).toEqual([boss.id, deep]);
		expect(path.top?.id).toBe(boss.id);
		expect(path.children).toHaveLength(201);
		expect(path.children.map((c) => c.id)).toContain(deep);
		const root = await inWide((tx) => chartPathTo(tx, lastRoot));
		expect([root.chain, root.top?.id, root.children]).toEqual([[lastRoot], lastRoot, []]);
	});

	it('returns every day of the week in a zone that skips midnight for daylight saving', async () => {
		const zone = await createTenant('zone');
		await withTenant(systemCtx(zone.id), (tx) => seedTenant(tx, zone.id, TEST_LOCALE));
		await sql()`insert into employees (tenant_id, code, full_name, employment_type, status, join_date)
			select ${zone.id}, 'D' || g, 'Day ' || g, 'full_time', 'active', ('2025-09-03'::date + g)
			from generate_series(1, 7) g`;
		const week = await withTenant(systemCtx(zone.id), async (tx) => {
			await tx.execute(drizzleSql`select set_config('TimeZone', 'America/Santiago', true)`);
			return celebrations(tx, '2026-09-04', 7, false);
		});
		expect(week.map((c) => c.date)).toEqual([
			'2026-09-04',
			'2026-09-05',
			'2026-09-06',
			'2026-09-07',
			'2026-09-08',
			'2026-09-09',
			'2026-09-10'
		]);
	});

	it('loads the top of a 5,000 person chart in under 300 ms', async () => {
		const big = await createTenant('chart');
		await withTenant(systemCtx(big.id), (tx) => seedTenant(tx, big.id, TEST_LOCALE));
		await sql()`insert into employees (tenant_id, code, full_name, employment_type, status, join_date)
			select ${big.id}, 'P' || g, 'Person ' || g, 'full_time', 'active', '2020-01-01' from generate_series(1, 5000) g`;
		await sql()`update employees e set manager_id = m.id from employees m
			where e.tenant_id = ${big.id} and m.tenant_id = ${big.id}
			and substr(e.code, 2)::int >= 10 and m.code = 'P' || (substr(e.code, 2)::int / 10)`;
		await sql()`analyze employees`;
		const load = () => withTenant(systemCtx(big.id), chartStart);
		await load();
		const started = performance.now();
		const start = await load();
		const took = performance.now() - started;
		expect(start.roots).toHaveLength(9);
		expect(start.children).toHaveLength(90);
		expect(took).toBeLessThan(300);
	});
});
