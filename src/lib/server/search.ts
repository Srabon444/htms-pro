import { and, asc, desc, eq, inArray, ne, or, sql, type SQL } from 'drizzle-orm';
import { alias, type PgColumn } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { moduleOn } from '../modules';
import { runName } from '../payroll';
import type { Permission } from '../rbac/permissions';
import { canRunAnnouncements, liveFor } from './announcements';
import { singleAdmin } from './approval-chain';
import { visibleAssets } from './assets';
import { containsPattern, likeEscape } from './db/like';
import {
	announcements,
	assets,
	candidates,
	courses,
	employeeDocuments,
	employees,
	events,
	expenseClaims,
	jobOpenings,
	kbArticles,
	letters,
	payrollRuns,
	policies,
	projects,
	ticketCategories,
	tickets
} from './db/schema';
import { listedEvents } from './events';
import { visibleTickets } from './helpdesk';
import { articleScope } from './knowledge';
import { tenantToday } from './lifecycle';
import { log } from './log';
import { moduleOverrides } from './modules';
import { searchProviderFailures } from './metrics';
import { canSeePayroll } from './payroll';
import { canRunPolicies } from './policies';
import { visibleProjects } from './projects';
import { can, type Access } from './rbac/access';
import { resolveScope, scopeWhere, type ScopeSet } from './rbac/scope';
import type { Tx } from './tenancy';

export const SEARCH_KINDS = [
	'employee',
	'document',
	'letter',
	'policy',
	'article',
	'announcement',
	'event',
	'ticket',
	'expense',
	'asset',
	'project',
	'opening',
	'candidate',
	'payroll',
	'course'
] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];
export type SearchHit = { kind: SearchKind; id: string; title: string; sub: string | null; href: string };

export const searchQuery = z
	.string()
	.trim()
	.min(2)
	.max(80)
	.refine((v) => !/\p{Cc}/u.test(v));

const PER_KIND = 5;
const DEADLINE_MS = 2500;
const STATEMENT_MS = 800;

type Find = {
	tx: Tx;
	access: Access;
	q: string;
	number: number | null;
	scope: (permission: Permission) => Promise<ScopeSet>;
	match: (...columns: (PgColumn | SQL)[]) => SQL;
	rank: (column: PgColumn | SQL) => SQL;
};
type Viewer = { access: Access; active: boolean };
type Provider = {
	kind: SearchKind;
	allowed(viewer: Viewer): boolean;
	find(f: Find): Promise<SearchHit[]>;
};

const anyOf = (access: Access, perms: Permission[]) => perms.some((p) => can(access, p));
const joined = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(' · ') || null;
const requester = alias(employees, 'search_requester');
const HEADLINE = 'StartSel="", StopSel="", MaxWords=14, MinWords=5, MaxFragments=1';

const FILE_SOURCES = {
	policy: sql.raw('ft.policy_id = policies.id'),
	candidate: sql.raw('ft.candidate_id = candidates.id')
};

export const inFileText = (q: string, source: keyof typeof FILE_SOURCES, headline = HEADLINE) => {
	const query = sql`plainto_tsquery('simple', ${q})`;
	const where = sql`from file_texts ft where ${FILE_SOURCES[source]} and ft.status = 'ok' and ft.tsv @@ ${query}`;
	return {
		hit: sql`exists (select 1 ${where})`,
		snippet: sql<string | null>`(select ts_headline('simple', ft.text, ${query}, ${headline}) ${where} limit 1)`
	};
};

const PROVIDERS: Provider[] = [
	{
		kind: 'employee',
		allowed: ({ access }) => can(access, 'employee.read'),
		async find({ tx, scope, match, rank }) {
			const rows = await tx
				.select({ id: employees.id, name: employees.fullName, code: employees.code, email: employees.workEmail })
				.from(employees)
				.where(
					and(
						scopeWhere(await scope('employee.read'), employees.id),
						match(employees.fullName, employees.code, employees.workEmail)
					)
				)
				.orderBy(rank(employees.code), rank(employees.fullName), asc(employees.fullName))
				.limit(PER_KIND);
			return rows.map((r) => ({
				kind: 'employee',
				id: r.id,
				title: r.name,
				sub: joined(r.code, r.email),
				href: `employees/${r.id}`
			}));
		}
	},
	{
		kind: 'document',
		allowed: ({ access }) => can(access, 'employee.read') && can(access, 'document.read'),
		async find({ tx, scope, match, rank }) {
			const rows = await tx
				.select({
					id: employeeDocuments.id,
					title: employeeDocuments.title,
					employeeId: employeeDocuments.employeeId,
					name: employees.fullName
				})
				.from(employeeDocuments)
				.innerJoin(employees, eq(employees.id, employeeDocuments.employeeId))
				.where(
					and(
						scopeWhere(await scope('employee.read'), employeeDocuments.employeeId),
						scopeWhere(await scope('document.read'), employeeDocuments.employeeId),
						match(employeeDocuments.title)
					)
				)
				.orderBy(rank(employeeDocuments.title), desc(employeeDocuments.createdAt))
				.limit(PER_KIND);
			return rows.map((r) => ({
				kind: 'document',
				id: r.id,
				title: r.title,
				sub: r.name,
				href: `employees/${r.employeeId}`
			}));
		}
	},
	{
		kind: 'letter',
		allowed: () => true,
		async find({ tx, access, number, scope, match, rank }) {
			const me = access.employeeId;
			const rows = await tx
				.select({ id: letters.id, number: letters.number, subject: letters.subject, name: employees.fullName })
				.from(letters)
				.innerJoin(employees, eq(employees.id, letters.employeeId))
				.where(
					and(
						or(
							me ? eq(letters.employeeId, me) : undefined,
							scopeWhere(await scope('letter.issue'), letters.employeeId)
						),
						number === null ? match(letters.subject) : or(match(letters.subject), eq(letters.number, number))
					)
				)
				.orderBy(rank(sql`${letters.number}::text`), rank(letters.subject), desc(letters.number))
				.limit(PER_KIND);
			return rows.map((r) => ({
				kind: 'letter',
				id: r.id,
				title: `#${r.number} ${r.subject}`,
				sub: r.name,
				href: 'letters'
			}));
		}
	},
	{
		kind: 'policy',
		allowed: ({ active }) => active,
		async find({ tx, access, q, match, rank }) {
			const manager = canRunPolicies(access);
			const text = inFileText(q, 'policy');
			const rows = await tx
				.select({
					id: policies.id,
					title: policies.title,
					version: policies.version,
					active: policies.active,
					snippet: text.snippet
				})
				.from(policies)
				.where(
					and(
						manager ? undefined : eq(policies.active, true),
						or(match(policies.title, policies.description), text.hit)
					)
				)
				.orderBy(rank(policies.title), asc(policies.title))
				.limit(PER_KIND);
			return rows.map((r) => ({
				kind: 'policy',
				id: r.id,
				title: r.title,
				sub: joined(`Version ${r.version}`, r.active ? null : 'Inactive', r.snippet),
				href: manager ? `policies/${r.id}` : `policies/${r.id}/file`
			}));
		}
	},
	{
		kind: 'article',
		allowed: ({ active }) => active,
		async find({ tx, access, match, rank }) {
			if (!moduleOn(await moduleOverrides(tx), 'knowledge')) return [];
			const rows = await tx
				.select({ id: kbArticles.id, title: kbArticles.title, status: kbArticles.status })
				.from(kbArticles)
				.where(and(await articleScope(tx, access), match(kbArticles.title, kbArticles.bodyMd)))
				.orderBy(rank(kbArticles.title), asc(kbArticles.title))
				.limit(PER_KIND);
			return rows.map((r) => ({
				kind: 'article',
				id: r.id,
				title: r.title,
				sub: r.status === 'draft' ? 'Draft' : null,
				href: `knowledge/${r.id}`
			}));
		}
	},
	{
		kind: 'announcement',
		allowed: ({ active }) => active,
		async find({ tx, access, match, rank }) {
			const rows = await tx
				.select({ id: announcements.id, title: announcements.title, publishOn: announcements.publishOn })
				.from(announcements)
				.where(and(canRunAnnouncements(access) ? undefined : await liveFor(tx, access), match(announcements.title)))
				.orderBy(rank(announcements.title), desc(announcements.publishOn))
				.limit(PER_KIND);
			return rows.map((r) => ({
				kind: 'announcement',
				id: r.id,
				title: r.title,
				sub: r.publishOn,
				href: 'announcements'
			}));
		}
	},
	{
		kind: 'event',
		allowed: ({ access, active }) => active && can(access, 'calendar.read'),
		async find({ tx, access, match, rank }) {
			if (!moduleOn(await moduleOverrides(tx), 'events')) return [];
			const rows = await tx
				.select({ id: events.id, title: events.title, startDate: events.startDate, location: events.location })
				.from(events)
				.where(and(await listedEvents(tx, access, await tenantToday(tx)), match(events.title, events.location)))
				.orderBy(rank(events.title), asc(events.startDate))
				.limit(PER_KIND);
			return rows.map((r) => ({
				kind: 'event',
				id: r.id,
				title: r.title,
				sub: joined(r.startDate, r.location),
				href: 'events'
			}));
		}
	},
	{
		kind: 'ticket',
		allowed: () => true,
		async find({ tx, access, number, match, rank }) {
			const rows = await tx
				.select({
					id: tickets.id,
					number: tickets.number,
					subject: tickets.subject,
					category: ticketCategories.name,
					confidential: ticketCategories.confidential,
					requester: requester.fullName
				})
				.from(tickets)
				.innerJoin(ticketCategories, eq(ticketCategories.id, tickets.categoryId))
				.innerJoin(requester, eq(requester.id, tickets.requesterEmployeeId))
				.where(
					and(
						await visibleTickets(tx, access),
						or(
							and(eq(ticketCategories.confidential, false), match(tickets.subject)),
							number === null ? undefined : eq(tickets.number, number)
						)
					)
				)
				.orderBy(rank(sql`${tickets.number}::text`), desc(tickets.number))
				.limit(PER_KIND);
			return rows.map((r) => ({
				kind: 'ticket',
				id: r.id,
				title: r.confidential ? `Confidential ticket #${r.number}` : `#${r.number} ${r.subject}`,
				sub: joined(r.category, r.confidential ? null : r.requester),
				href: `helpdesk/${r.id}`
			}));
		}
	},
	{
		kind: 'expense',
		allowed: ({ access }) => anyOf(access, ['expense.submit', 'expense.approve', 'expense.pay']),
		async find({ tx, access, scope, match, rank }) {
			const me = access.employeeId;
			const notMine = me && !(await singleAdmin(tx)) ? ne(expenseClaims.employeeId, me) : sql`true`;
			const rows = await tx
				.select({
					id: expenseClaims.id,
					title: expenseClaims.title,
					status: expenseClaims.status,
					name: employees.fullName
				})
				.from(expenseClaims)
				.innerJoin(employees, eq(employees.id, expenseClaims.employeeId))
				.where(
					and(
						or(
							me ? eq(expenseClaims.employeeId, me) : undefined,
							and(
								eq(expenseClaims.status, 'submitted'),
								scopeWhere(await scope('expense.approve'), expenseClaims.employeeId),
								notMine
							),
							and(
								eq(expenseClaims.status, 'approved'),
								eq(expenseClaims.payVia, 'direct'),
								scopeWhere(await scope('expense.pay'), expenseClaims.employeeId),
								notMine
							)
						),
						match(expenseClaims.title)
					)
				)
				.orderBy(rank(expenseClaims.title), desc(expenseClaims.createdAt))
				.limit(PER_KIND);
			return rows.map((r) => ({
				kind: 'expense',
				id: r.id,
				title: r.title,
				sub: joined(r.name, r.status),
				href: 'expenses'
			}));
		}
	},
	{
		kind: 'asset',
		allowed: ({ access }) => can(access, 'asset.read'),
		async find({ tx, access, match, rank }) {
			const rows = await tx
				.select({ id: assets.id, tag: assets.tag, name: assets.name, category: assets.category })
				.from(assets)
				.where(and(await visibleAssets(tx, access), match(assets.tag, assets.name, assets.serial)))
				.orderBy(rank(assets.tag), rank(assets.name), asc(assets.tag))
				.limit(PER_KIND);
			return rows.map((r) => ({
				kind: 'asset',
				id: r.id,
				title: `${r.tag} ${r.name}`,
				sub: r.category,
				href: `assets/${r.id}`
			}));
		}
	},
	{
		kind: 'project',
		allowed: ({ access }) => can(access, 'project.read'),
		async find({ tx, scope, match, rank }) {
			const rows = await tx
				.select({ id: projects.id, code: projects.code, name: projects.name, client: projects.client })
				.from(projects)
				.where(and(visibleProjects(await scope('project.read')), match(projects.code, projects.name, projects.client)))
				.orderBy(rank(projects.code), rank(projects.name), asc(projects.code))
				.limit(PER_KIND);
			return rows.map((r) => ({
				kind: 'project',
				id: r.id,
				title: `${r.code} ${r.name}`,
				sub: r.client || null,
				href: `projects/${r.id}`
			}));
		}
	},
	{
		kind: 'opening',
		allowed: ({ access }) => can(access, 'recruitment.read'),
		async find({ tx, match, rank }) {
			const rows = await tx
				.select({ id: jobOpenings.id, title: jobOpenings.title, status: jobOpenings.status })
				.from(jobOpenings)
				.where(match(jobOpenings.title))
				.orderBy(rank(jobOpenings.title), desc(jobOpenings.createdAt))
				.limit(PER_KIND);
			return rows.map((r) => ({
				kind: 'opening',
				id: r.id,
				title: r.title,
				sub: r.status,
				href: `recruitment/${r.id}`
			}));
		}
	},
	{
		kind: 'candidate',
		allowed: ({ access }) => can(access, 'recruitment.read'),
		async find({ tx, q, match, rank }) {
			const text = inFileText(q, 'candidate');
			const rows = await tx
				.select({
					id: candidates.id,
					name: candidates.fullName,
					email: candidates.email,
					opening: jobOpenings.title,
					snippet: text.snippet
				})
				.from(candidates)
				.innerJoin(jobOpenings, eq(jobOpenings.id, candidates.openingId))
				.where(or(match(candidates.fullName, candidates.email), text.hit))
				.orderBy(rank(candidates.fullName), desc(candidates.createdAt))
				.limit(PER_KIND);
			return rows.map((r) => ({
				kind: 'candidate',
				id: r.id,
				title: r.name,
				sub: joined(r.opening, r.email, r.snippet),
				href: `recruitment/candidates/${r.id}`
			}));
		}
	},
	{
		kind: 'payroll',
		allowed: ({ access }) => canSeePayroll(access),
		async find({ tx, match, rank }) {
			const latest = tx
				.select({ id: payrollRuns.id })
				.from(payrollRuns)
				.orderBy(desc(payrollRuns.period), desc(payrollRuns.createdAt))
				.limit(36);
			const rows = await tx
				.select({
					id: payrollRuns.id,
					runType: payrollRuns.runType,
					title: payrollRuns.title,
					period: payrollRuns.period,
					status: payrollRuns.status,
					leaver: employees.fullName
				})
				.from(payrollRuns)
				.leftJoin(employees, eq(employees.id, payrollRuns.employeeId))
				.where(
					and(
						inArray(payrollRuns.id, latest),
						match(payrollRuns.title, payrollRuns.period, payrollRuns.runType, employees.fullName)
					)
				)
				.orderBy(rank(payrollRuns.period), desc(payrollRuns.period))
				.limit(PER_KIND);
			return rows.map((r) => ({
				kind: 'payroll',
				id: r.id,
				title: joined(runName(r), r.leaver) ?? r.period,
				sub: joined(r.period, r.status),
				href: `payroll?run=${r.id}`
			}));
		}
	},
	{
		kind: 'course',
		allowed: ({ active }) => active,
		async find({ tx, access, match, rank }) {
			if (!moduleOn(await moduleOverrides(tx), 'learning')) return [];
			const rows = await tx
				.select({ id: courses.id, title: courses.title, status: courses.status })
				.from(courses)
				.where(and(can(access, 'course.manage') ? undefined : eq(courses.status, 'published'), match(courses.title)))
				.orderBy(rank(courses.title), asc(courses.title))
				.limit(PER_KIND);
			return rows.map((r) => ({
				kind: 'course',
				id: r.id,
				title: r.title,
				sub: r.status,
				href: `learning/${r.id}`
			}));
		}
	}
];

export const searchKinds = (): SearchKind[] => PROVIDERS.map((p) => p.kind);

export async function globalSearch(tx: Tx, viewer: Viewer, raw: string): Promise<SearchHit[]> {
	const q = searchQuery.parse(raw);
	const like = containsPattern(q);
	const prefix = `${likeEscape(q)}%`;
	const lower = q.toLowerCase();
	const scopes = new Map<Permission, Promise<ScopeSet>>();
	const find = {
		tx,
		access: viewer.access,
		q,
		number: /^#?\d{1,9}$/.test(q) ? Number(q.replace('#', '')) : null,
		scope: (p: Permission) => {
			if (!scopes.has(p)) scopes.set(p, resolveScope(tx, viewer.access, p));
			return scopes.get(p)!;
		},
		match: (...columns: (PgColumn | SQL)[]) => or(...columns.map((c) => sql`${c}::text ilike ${like}`))!,
		rank: (c: PgColumn | SQL) =>
			sql`case when lower(${c}::text) = ${lower} then 0 when ${c}::text ilike ${prefix} then 1 else 2 end`
	};
	const started = Date.now();
	return PROVIDERS.filter((p) => p.allowed(viewer)).reduce<Promise<SearchHit[]>>(
		(prior, p) => prior.then(async (hits) => hits.concat(await searchOne(p, find, started))),
		Promise.resolve([])
	);
}

async function searchOne(p: Provider, find: Find, started: number): Promise<SearchHit[]> {
	const left = Math.min(STATEMENT_MS, DEADLINE_MS - (Date.now() - started));
	if (left < 50) {
		searchProviderFailures.inc({ kind: p.kind, reason: 'deadline' });
		return [];
	}
	try {
		return await find.tx.transaction(async (sp) => {
			await sp.execute(sql.raw(`set local statement_timeout = ${Math.floor(left)}`));
			return p.find({ ...find, tx: sp });
		});
	} catch (err) {
		searchProviderFailures.inc({ kind: p.kind, reason: 'error' });
		log.warn({ kind: p.kind, err: (err as Error).message }, 'search provider failed');
		return [];
	}
}
