import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApiKey } from '../../src/lib/server/api-keys';
import { addManualPunch, punch } from '../../src/lib/server/attendance';
import {
	clearReview,
	createDevice,
	listDevices,
	listReview,
	manager,
	revokeDevice,
	rotateDeviceKey,
	setDeviceUserId
} from '../../src/lib/server/attendance-devices';
import { sha256 } from '../../src/lib/server/auth/crypto';
import { hashPassword } from '../../src/lib/server/auth/password';
import { confirmRecentAuth } from '../../src/lib/server/auth/service';
import { createSession } from '../../src/lib/server/auth/session';
import { withTestNow } from '../../src/lib/server/clock';
import { closePools, ownerPool } from '../../src/lib/server/db';
import { attendancePunches, employees, memberships } from '../../src/lib/server/db/schema';
import { createEmployee, EMPLOYMENT_FIELDS, PROFILE_FIELDS } from '../../src/lib/server/employees';
import { addMember, seedTenant } from '../../src/lib/server/platform/tenants';
import { apiRequest } from '../../src/lib/server/public/api';
import { loadAccess, type requireMember } from '../../src/lib/server/rbac/access';
import { closeRedis, redisReady, rkey } from '../../src/lib/server/redis';
import { systemCtx, withTenant } from '../../src/lib/server/tenancy';
import { listWorkSites, saveWorkSite } from '../../src/lib/server/work-sites';
import { createTenant, createUser, TEST_LOCALE } from './helpers';

type Member = ReturnType<typeof requireMember>;
type Tenant = { id: string; slug: string };
type Reply = {
	accepted: number;
	duplicates: number;
	rejected: number;
	flagged: number;
	results: { index: number; status: string; reason?: string; flagged?: boolean }[];
};
const outcome = (b: Reply) => b.results.map((r) => [r.index, r.reason ?? r.status]);
let tenant: Tenant;
let other: Tenant;
const ids: Record<string, string> = {};
const codes: Record<string, string> = {};
const who: Record<string, Member> = {};
const PASSWORD = 'correct horse battery staple 42';
const IP = '203.0.113.60';
const NOW = '2026-11-24T09:00:00+06:00';
const at = <T>(iso: string, fn: () => Promise<T>) => withTestNow(iso, fn);
const sys = (t = tenant) => systemCtx(t.id);
const code = (p: Promise<unknown>) =>
	p
		.then(() => 'ok')
		.catch((e: { code?: string; issues?: unknown[] }) => (e.issues ? 'invalid' : (e.code ?? String(e))));
const blanks = Object.fromEntries(Object.keys({ ...PROFILE_FIELDS, ...EMPLOYMENT_FIELDS }).map((k) => [k, '']));
const hr = {
	membershipId: '',
	employeeId: null,
	grants: { 'employee.read': ['all'], 'employee.create': ['all'] }
};

async function member(t: Tenant, key: string, roleKeys: string[], extra: Record<string, string> = {}) {
	const employeeId = await createEmployee(
		{ tenantId: t.id, actor: 'user' },
		{ ...hr, roleKeys: [], isOwner: false } as never,
		{
			...blanks,
			fullName: `${key} person`,
			employmentType: 'full_time',
			status: 'active',
			joinDate: '2026-01-01',
			...extra
		}
	);
	const u = await createUser();
	await ownerPool().sql`update users set password_hash = ${await hashPassword(PASSWORD)} where id = ${u.id}`;
	const id = await withTenant(sys(t), async (tx) => {
		const membershipId = await addMember(tx, t.id, u.id, roleKeys);
		await tx.update(memberships).set({ employeeId }).where(eq(memberships.id, membershipId));
		const [e] = await tx.select({ code: employees.code }).from(employees).where(eq(employees.id, employeeId));
		codes[key] = e.code;
		return membershipId;
	});
	const { token } = await createSession(u.id, {});
	ids[key] = employeeId;
	who[key] = {
		user: { userId: u.id, sessionId: sha256(token), totpEnabled: false },
		tenant: { id: t.id, slug: t.slug, name: t.slug },
		access: await loadAccess(t.id, { id, status: 'active', employeeId })
	} as unknown as Member;
}

async function send(key: string, body: unknown, init: RequestInit = {}, ip = IP) {
	const res = await apiRequest(
		new Request('http://localhost/api/v1/punches', {
			method: 'POST',
			body: typeof body === 'string' ? body : JSON.stringify(body),
			...init,
			headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', ...init.headers }
		}),
		'punches',
		ip
	);
	return { status: res.status, body: (await res.json()) as Reply & { error?: string } };
}

async function newDevice(m: Member, name: string, siteId = '') {
	await confirmRecentAuth(m.user, PASSWORD, '');
	return createDevice(m, { name, siteId, serial: 'ZK-1' });
}

const punchesOf = (key: string) =>
	withTenant(sys(), (tx) => tx.select().from(attendancePunches).where(eq(attendancePunches.employeeId, ids[key])));

async function closeMonth(period: string) {
	await ownerPool().sql`
		insert into payroll_runs (tenant_id, period, status, inputs_hash, output_hash, computed_by_user_id, computed_at)
		values (${tenant.id}, ${period}, 'approved', 'x', 'x', ${who.own.user.userId}, now())`;
}

beforeAll(async () => {
	tenant = await createTenant('dev');
	other = await createTenant('devb');
	await withTenant(sys(), (tx) => seedTenant(tx, tenant.id, TEST_LOCALE));
	await withTenant(sys(other), (tx) => seedTenant(tx, other.id, TEST_LOCALE));
	await member(tenant, 'own', ['owner']);
	await member(tenant, 'tia', ['employee']);
	await member(tenant, 'uma', ['employee']);
	await member(tenant, 'late', ['employee'], { joinDate: '2026-11-20' });
	await member(tenant, 'vic', ['employee']);
	await member(other, 'olga', ['owner']);
	await saveWorkSite({ tenantId: tenant.id, actor: 'user' }, '', {
		name: 'Gate',
		branchId: '',
		lat: '23.7808',
		lng: '90.4074',
		radiusM: '200',
		ipCidrs: '',
		active: 'on'
	});
	const r = await redisReady();
	await r.del(
		rkey('rl', 'api-auth-fail', IP),
		rkey('rl', 'api-auth-fail', '203.0.113.61'),
		rkey('rl', 'api-auth-fail', '203.0.113.62'),
		...Object.values(who).map((m) => rkey('rl', 'reauth', m.user.userId))
	);
});

afterAll(async () => {
	await closeRedis();
	await closePools();
});

describe('adding attendance devices', () => {
	it('needs everyone’s attendance and a fresh password, and stores only the hash', async () => {
		await at(NOW, async () => {
			await confirmRecentAuth(who.tia.user, PASSWORD, '');
			expect(await code(createDevice(who.tia, { name: 'Mine', siteId: '', serial: '' }))).toBe('forbidden');
			expect(await code(createDevice(who.own, { name: 'Early', siteId: '', serial: '' }))).toBe('reauth_required');
			await confirmRecentAuth(who.own.user, PASSWORD, '');
			expect(await code(createDevice(who.own, { name: '', siteId: '', serial: '' }))).toBe('invalid');
			expect(
				await code(createDevice(who.own, { name: 'Bad', siteId: '00000000-0000-4000-8000-000000000000', serial: '' }))
			).toBe('invalid');
			const [site] = await withTenant(sys(), listWorkSites);
			const key = await createDevice(who.own, { name: 'Front door', siteId: site.id, serial: 'ZK-9' });
			expect(key).toMatch(/^hrd_[0-9a-f]{8}_[A-Za-z0-9_-]{43}$/);
			expect(await code(createDevice(who.own, { name: 'Front door', siteId: '', serial: '' }))).toBe('duplicate');
			const [row] = await ownerPool().sql<{ key_hash: string; prefix: string }[]>`
				select key_hash, prefix from attendance_devices where tenant_id = ${tenant.id} and name = 'Front door'`;
			expect(row.key_hash).toBe(sha256(key));
			expect(key.startsWith(`hrd_${row.prefix}_`)).toBe(true);
			const [audit] = await ownerPool().sql`
				select new_values from audit_log where tenant_id = ${tenant.id} and event = 'attendance_device.create'`;
			expect(JSON.stringify(audit)).not.toContain(key.slice(`hrd_${row.prefix}_`.length));
		});
	});

	it('keeps the page and its actions to people who manage everyone’s attendance', () => {
		const team = { ...who.own, access: { ...who.own.access, grants: { 'attendance.manage': ['team'] } } } as Member;
		expect(() => manager(team)).toThrow(/everyone’s attendance/);
		expect(() => manager(who.own)).not.toThrow();
	});

	it('sets device user IDs by employee code and keeps them unique', async () => {
		expect(await code(setDeviceUserId(who.tia, { code: codes.uma, deviceUserId: '7' }))).toBe('forbidden');
		expect(await setDeviceUserId(who.own, { code: codes.tia.toLowerCase(), deviceUserId: '101' })).toBe('tia person');
		expect(await code(setDeviceUserId(who.own, { code: codes.uma, deviceUserId: '101' }))).toBe('duplicate');
		expect(await code(setDeviceUserId(who.own, { code: codes.uma, deviceUserId: 'bad id' }))).toBe('invalid');
		expect(await code(setDeviceUserId(who.own, { code: 'NOPE-1', deviceUserId: '5' }))).toBe('not_found');
		await setDeviceUserId(who.own, { code: codes.uma, deviceUserId: '5' });
		await setDeviceUserId(who.own, { code: codes.uma, deviceUserId: '' });
		const [uma] = await withTenant(sys(), (tx) =>
			tx.select({ d: employees.deviceUserId }).from(employees).where(eq(employees.id, ids.uma))
		);
		expect(uma.d).toBeNull();
	});
});

describe('POST /api/v1/punches', () => {
	let key: string;
	beforeAll(async () => {
		key = await at(NOW, () => newDevice(who.own, 'Back door'));
	});

	it('saves a batch, recomputes the day and skips repeats', async () => {
		const batch = {
			punches: [
				{ deviceUserId: '101', at: '2026-11-24T08:58:00+06:00', direction: 'in' },
				{ employeeCode: codes.uma.toLowerCase(), at: '2026-11-24T09:01:00+06:00' },
				{ deviceUserId: '999', at: '2026-11-24T09:00:00+06:00' },
				{ deviceUserId: '101', at: '2026-10-01T09:00:00+06:00' },
				{ deviceUserId: '101', at: '2026-11-24T12:00:00+06:00' },
				{ employeeCode: codes.late, at: '2026-11-18T09:00:00+06:00' },
				{ employeeCode: codes.uma, at: '2026-11-24 09:00' },
				{ at: '2026-11-24T09:00:00+06:00' },
				{ employeeCode: codes.uma, at: '2026-11-24T09:01:00+06:00', direction: 'sideways' }
			]
		};
		const first = await at(NOW, () => send(key, batch));
		expect(first.status).toBe(200);
		expect([first.body.accepted, first.body.duplicates, first.body.rejected, first.body.flagged]).toEqual([2, 0, 7, 0]);
		expect(outcome(first.body)).toEqual([
			[0, 'accepted'],
			[1, 'accepted'],
			[2, 'unknown_user'],
			[3, 'too_old'],
			[4, 'in_future'],
			[5, 'not_employed'],
			[6, 'invalid'],
			[7, 'invalid'],
			[8, 'invalid']
		]);
		const [p] = await punchesOf('tia');
		const [device] = await withTenant(sys(), listDevices).then((d) => d.filter((x) => x.name === 'Back door'));
		expect([p.source, p.kind, p.deviceId, p.needsReview]).toEqual(['device', 'in', device.id, false]);
		expect(device.lastSeenAt).not.toBeNull();
		const [day] = await ownerPool().sql<{ status: string }[]>`
			select status from attendance_days where employee_id = ${ids.tia} and date = '2026-11-24'`;
		expect(day?.status).toBeTruthy();
		const again = await at(NOW, () =>
			send(key, {
				punches: [batch.punches[0], { deviceUserId: '101', at: '2026-11-24T08:59:00+06:00' }, batch.punches[0]]
			})
		);
		expect(outcome(again.body)).toEqual([
			[0, 'duplicate'],
			[1, 'accepted'],
			[2, 'duplicate']
		]);
		await withTenant(sys(), (tx) =>
			tx.delete(attendancePunches).where(eq(attendancePunches.at, new Date('2026-11-24T08:59:00+06:00')))
		);
		expect(await punchesOf('tia')).toHaveLength(1);
	});

	it('refuses bad requests before touching data', async () => {
		await at(NOW, async () => {
			expect((await send(key, '{"punches":')).status).toBe(400);
			expect((await send(key, { punches: [] })).status).toBe(400);
			expect((await send(key, { punches: Array(501).fill({}) })).status).toBe(400);
			expect((await send(key, [1, 2])).status).toBe(400);
			expect((await send(key, { punches: [] }, { headers: { 'content-type': 'text/plain' } })).status).toBe(415);
			expect((await send(key, 'x'.repeat(300 * 1024))).status).toBe(413);
			const get = await apiRequest(
				new Request('http://localhost/api/v1/punches', { headers: { authorization: `Bearer ${key}` } }),
				'punches',
				IP
			);
			expect(get.status).toBe(405);
		});
	});

	it('only takes a live device key from this tenant', async () => {
		const ip = '203.0.113.61';
		await at(NOW, async () => {
			const one = { punches: [{ deviceUserId: '555', at: '2026-11-24T09:00:00+06:00' }] };
			expect((await send('hrd_00000000_' + 'a'.repeat(43), one, {}, ip)).status).toBe(401);
			expect((await send(key.replace(/.$/, key.endsWith('a') ? 'b' : 'a'), one, {}, ip)).status).toBe(401);
			await confirmRecentAuth(who.own.user, PASSWORD, '');
			const apiKey = await createApiKey(who.own, { name: 'Reader', days: '90', 'grant.attendance.read': 'all' });
			expect((await send(apiKey, one, {}, ip)).status).toBe(401);
			const cross = await send(key, one, {}, ip);
			expect(outcome(cross.body)).toEqual([[0, 'unknown_user']]);
			await setDeviceUserId(who.olga, { code: codes.olga, deviceUserId: '555' });
			const otherKey = await newDevice(who.olga, 'Olga door');
			const own = await send(otherKey, { punches: [{ deviceUserId: '101', at: '2026-11-24T09:00:00+06:00' }] }, {}, ip);
			expect(outcome(own.body)).toEqual([[0, 'unknown_user']]);
			const spare = await newDevice(who.own, 'Spare');
			const [d] = (await withTenant(sys(), listDevices)).filter((x) => x.name === 'Spare');
			const fresh = await rotateDeviceKey(who.own, d.id);
			expect((await send(spare, one, {}, ip)).status).toBe(401);
			expect((await send(fresh, one, {}, ip)).status).toBe(200);
			await revokeDevice(who.own, d.id);
			expect((await send(fresh, one, {}, ip)).status).toBe(401);
			expect(await code(revokeDevice(who.own, d.id))).toBe('not_found');
		});
		const r = await redisReady();
		await r.del(rkey('rl', 'api-auth-fail', ip));
	});

	it('keeps working devices going when another key on the same network keeps failing', async () => {
		const ip = '203.0.113.62';
		await at(NOW, async () => {
			const one = { punches: [{ deviceUserId: '555', at: '2026-11-24T09:00:00+06:00' }] };
			const wrong = `hrd_00000000_${'b'.repeat(43)}`;
			const bad = await Promise.all(Array.from({ length: 30 }, () => send(wrong, one, {}, ip)));
			expect(bad.every((r) => r.status === 401)).toBe(true);
			expect((await send(wrong, one, {}, ip)).status).toBe(429);
			expect((await send(key, one, {}, ip)).status).toBe(200);
		});
		const r = await redisReady();
		await r.del(rkey('rl', 'api-auth-fail', ip));
	});

	it('limits each device to 60 requests a minute', async () => {
		const limited = await at(NOW, async () => {
			const k = await newDevice(who.own, 'Busy');
			const replies = await Promise.all(Array.from({ length: 61 }, () => send(k, '{')));
			return replies.map((r) => r.status);
		});
		expect(limited.filter((s) => s === 400)).toHaveLength(60);
		expect(limited.filter((s) => s === 429)).toHaveLength(1);
	});
});

describe('punches after payroll is approved', () => {
	it('flags device and web punches in a closed month, not manual ones, until checked', async () => {
		await closeMonth('2026-10');
		const key = await at('2026-11-02T09:00:00+06:00', () => newDevice(who.own, 'Late door'));
		const late = await at('2026-11-02T09:00:00+06:00', () =>
			send(key, {
				punches: [
					{ deviceUserId: '101', at: '2026-10-30T09:00:00+06:00' },
					{ deviceUserId: '101', at: '2026-11-01T02:00:00+06:00' },
					{ deviceUserId: '101', at: '2026-11-01T14:00:00+06:00' },
					{ deviceUserId: '101', at: '2026-11-02T08:00:00+06:00' },
					{ employeeCode: codes.uma, at: '2026-11-02T08:30:00+06:00' }
				]
			})
		);
		expect([late.body.accepted, late.body.flagged]).toEqual([5, 2]);
		expect(late.body.results.map((r) => r.flagged)).toEqual([true, true, false, false, false]);
		const [{ n }] = await ownerPool().sql<{ n: number }[]>`
			select count(*)::int as n from attendance_days where employee_id = ${ids.uma} and date < '2026-11-01'`;
		expect(n).toBe(0);
		await at('2026-10-31T09:00:00+06:00', () => punch(who.vic, '198.51.100.20'));
		await at('2026-11-02T09:00:00+06:00', () => addManualPunch(who.own, ids.vic, { at: '2026-10-29T09:00' }));
		const vic = await punchesOf('vic');
		expect(vic.filter((p) => p.needsReview).map((p) => p.source)).toEqual(['web']);
		const review = await withTenant(sys(), listReview);
		expect(review.map((r) => [r.code, r.device ?? r.source])).toEqual([
			[codes.tia, 'Late door'],
			[codes.vic, 'web'],
			[codes.tia, 'Late door']
		]);
		expect(await code(clearReview(who.tia, [review[0].id]))).toBe('forbidden');
		expect(await code(clearReview(who.own, []))).toBe('invalid');
		expect(
			await clearReview(
				who.own,
				review.map((r) => r.id)
			)
		).toBe(3);
		expect(await withTenant(sys(), listReview)).toEqual([]);
		const [audit] = await ownerPool().sql<{ new_values: { count: string } }[]>`
			select new_values from audit_log where tenant_id = ${tenant.id} and event = 'attendance_punch.reviewed'`;
		expect(audit.new_values.count).toBe('3');
	});
});
