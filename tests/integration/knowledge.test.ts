import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MODULE_IDS, MODULES } from '../../src/lib/modules';
import { closePools, ownerPool } from '../../src/lib/server/db';
import { memberships } from '../../src/lib/server/db/schema';
import { createEmployee, EMPLOYMENT_FIELDS, PROFILE_FIELDS } from '../../src/lib/server/employees';
import {
	articlePage,
	deleteArticle,
	deleteFolder,
	KB,
	knowledgePage,
	saveArticle,
	saveFolder
} from '../../src/lib/server/knowledge';
import { saveModules } from '../../src/lib/server/modules';
import { addMember, seedTenant } from '../../src/lib/server/platform/tenants';
import { loadAccess, userCtx, type requireMember } from '../../src/lib/server/rbac/access';
import { globalSearch } from '../../src/lib/server/search';
import { systemCtx, withTenant } from '../../src/lib/server/tenancy';
import { createTenant, createUser, TEST_LOCALE } from './helpers';

type Member = ReturnType<typeof requireMember>;
type Tenant = { id: string; slug: string };
let a: Tenant;
let b: Tenant;
const ids: Record<string, string> = {};
const who: Record<string, Member> = {};
const sql = () => ownerPool().sql;
const blanks = Object.fromEntries(Object.keys({ ...PROFILE_FIELDS, ...EMPLOYMENT_FIELDS }).map((k) => [k, '']));
const creator = {
	membershipId: '',
	employeeId: null,
	grants: { 'employee.read': ['all'], 'employee.create': ['all'], 'employee.update': ['all'] },
	roleKeys: [],
	isOwner: false
};
const hire = (t: Tenant, fullName: string) =>
	createEmployee({ tenantId: t.id, actor: 'user' }, creator as never, {
		...blanks,
		fullName,
		employmentType: 'full_time',
		status: 'active',
		joinDate: '2026-01-01'
	});

async function member(t: Tenant, key: string, roles: string[], employeeId: string | null) {
	const user = await createUser();
	const id = await withTenant(systemCtx(t.id), async (tx) => {
		const membershipId = await addMember(tx, t.id, user.id, roles);
		await tx.update(memberships).set({ employeeId }).where(eq(memberships.id, membershipId));
		return membershipId;
	});
	who[key] = {
		user: { userId: user.id },
		tenant: { id: t.id, slug: t.slug, name: t.slug },
		access: await loadAccess(t.id, { id, status: 'active', employeeId })
	} as unknown as Member;
}

const page = (key: string, folder: string | null = null, q: string | null = null) =>
	withTenant(userCtx(who[key]), (tx) => knowledgePage(tx, who[key].access, { folder, q }));
const names = async (key: string, folder: string | null = null) => {
	const p = await page(key, folder);
	return p && { folders: p.children.map((f) => f.name), articles: p.articles.map((r) => r.title) };
};
const open = (key: string, id: string) => withTenant(userCtx(who[key]), (tx) => articlePage(tx, who[key].access, id));
const found = async (key: string, q: string) =>
	(await withTenant(userCtx(who[key]), (tx) => globalSearch(tx, { access: who[key].access, active: true }, q)))
		.filter((h) => h.kind === 'article')
		.map((h) => h.title)
		.sort();
const folder = (key: string, v: Record<string, string>) =>
	saveFolder(who[key], { audience: 'all', departmentId: '', branchId: '', ...v });
const article = (key: string, v: Record<string, string>) =>
	saveArticle(who[key], { articleId: '', folderId: '', bodyMd: '', status: 'published', ...v });

beforeAll(async () => {
	a = await createTenant('kba');
	b = await createTenant('kbb');
	await withTenant(systemCtx(a.id), (tx) => seedTenant(tx, a.id, TEST_LOCALE));
	await withTenant(systemCtx(b.id), (tx) => seedTenant(tx, b.id, TEST_LOCALE));
	const [eng] = await sql()<{ id: string }[]>`
		insert into departments (tenant_id, name) values (${a.id}, 'Engineering') returning id`;
	const [web] = await sql()<{ id: string }[]>`
		insert into departments (tenant_id, name, parent_id) values (${a.id}, 'Web', ${eng.id}) returning id`;
	const [sales] = await sql()<{ id: string }[]>`
		insert into departments (tenant_id, name) values (${a.id}, 'Sales') returning id`;
	const [dhaka] = await sql()<{ id: string }[]>`
		insert into branches (tenant_id, name) values (${a.id}, 'Dhaka') returning id`;
	Object.assign(ids, { eng: eng.id, web: web.id, sales: sales.id, dhaka: dhaka.id });
	ids.webby = await hire(a, 'Webby');
	ids.sally = await hire(a, 'Sally');
	await sql()`update employees set department_id = ${web.id} where id = ${ids.webby}`;
	await sql()`update employees set department_id = ${sales.id}, branch_id = ${dhaka.id} where id = ${ids.sally}`;
	await member(a, 'hr', ['hr_admin'], null);
	await member(a, 'webby', ['employee'], ids.webby);
	await member(a, 'sally', ['employee'], ids.sally);
	await member(a, 'nobody', ['employee'], null);
	await member(b, 'hrB', ['hr_admin'], null);

	ids.handbook = await folder('hr', { name: 'Handbook' });
	ids.engineering = await folder('hr', { name: 'Engineering', audience: 'department', departmentId: eng.id });
	ids.guides = await folder('hr', { name: 'Web guides', parentId: ids.engineering });
	ids.office = await folder('hr', { name: 'Dhaka office', audience: 'branch', branchId: dhaka.id });
	ids.salesOnly = await folder('hr', { name: 'Sales only', audience: 'department', departmentId: sales.id });
	ids.welcome = await article('hr', { title: 'Zebra welcome', bodyMd: '# Hi\n\nRead the **handbook**.' });
	ids.draft = await article('hr', { title: 'Zebra draft', status: 'draft' });
	ids.deploy = await article('hr', { title: 'Zebra deploy', folderId: ids.engineering, bodyMd: 'Ship on Tuesday' });
	ids.css = await article('hr', { title: 'Zebra css', folderId: ids.guides });
	ids.parking = await article('hr', { title: 'Zebra parking', folderId: ids.office });
	ids.quota = await article('hr', { title: 'Zebra quota', folderId: ids.salesOnly });
	await sql()`insert into policies (tenant_id, title, description, file_name, content_type, size_bytes, sha256, storage_key, published_on)
		values (${a.id}, 'Leave policy', 'How to ask for leave', 'p.pdf', 'application/pdf', 10, 'x', 'k', '2026-11-01'),
		(${a.id}, 'Old policy', '', 'o.pdf', 'application/pdf', 10, 'x', 'k2', '2026-11-01')`;
	await sql()`update policies set active = false where tenant_id = ${a.id} and title = 'Old policy'`;
});

afterAll(closePools);

describe('folder audience', () => {
	it('shows each person only the folders open to them, with sub-departments included', async () => {
		expect(await names('webby')).toEqual({ folders: ['Engineering', 'Handbook'], articles: ['Zebra welcome'] });
		expect(await names('webby', ids.engineering)).toEqual({ folders: ['Web guides'], articles: ['Zebra deploy'] });
		expect(await names('webby', ids.guides)).toEqual({ folders: [], articles: ['Zebra css'] });
		expect(await names('sally')).toEqual({
			folders: ['Dhaka office', 'Handbook', 'Sales only'],
			articles: ['Zebra welcome']
		});
		expect(await names('nobody')).toEqual({ folders: ['Handbook'], articles: ['Zebra welcome'] });
	});

	it('hides a folder inside a restricted folder from people outside it, even when the inner one is open to all', async () => {
		expect(await names('sally', ids.engineering)).toBeNull();
		expect(await names('sally', ids.guides)).toBeNull();
		expect(await open('sally', ids.css)).toBeNull();
		expect(await open('sally', ids.deploy)).toBeNull();
		expect(await names('webby', ids.salesOnly)).toBeNull();
		expect(await names('webby', 'not-a-uuid')).toBeNull();
	});

	it('keeps drafts to knowledge base managers', async () => {
		expect(await open('webby', ids.draft)).toBeNull();
		expect((await open('hr', ids.draft))?.article.title).toBe('Zebra draft');
		expect((await names('hr'))!.articles).toEqual(['Zebra draft', 'Zebra welcome']);
		expect((await names('hr'))!.folders).toEqual(['Dhaka office', 'Engineering', 'Handbook', 'Sales only']);
	});

	it('opens an article with its folder trail', async () => {
		const p = await open('webby', ids.css);
		expect(p?.trail.map((f) => f.name)).toEqual(['Engineering', 'Web guides']);
		expect(p?.folders).toEqual([]);
	});

	it('follows a changed audience at once', async () => {
		await folder('hr', { folderId: ids.engineering, name: 'Engineering', audience: 'branch', branchId: ids.dhaka });
		expect(await open('webby', ids.css)).toBeNull();
		expect((await open('sally', ids.css))?.article.title).toBe('Zebra css');
		await folder('hr', {
			folderId: ids.engineering,
			name: 'Engineering',
			audience: 'department',
			departmentId: ids.eng
		});
		expect((await open('webby', ids.css))?.article.title).toBe('Zebra css');
	});
});

describe('search', () => {
	it('searches titles and bodies inside the visible folders and lists active policies', async () => {
		const p = await page('webby', null, 'tuesday');
		expect(p!.articles.map((r) => [r.title, r.folder])).toEqual([['Zebra deploy', 'Engineering']]);
		expect((await page('sally', null, 'tuesday'))!.articles).toEqual([]);
		expect((await page('webby', null, 'leave'))!.policies.map((r) => r.title)).toEqual(['Leave policy']);
		expect((await page('webby'))!.policies.map((r) => r.title)).toEqual(['Leave policy']);
		expect((await page('webby', ids.engineering))!.policies).toEqual([]);
		const short = await page('webby', null, 'x');
		expect([short!.badQuery, short!.query]).toEqual([true, null]);
		expect((await page('webby', null, '100%'))!.articles).toEqual([]);
	});

	it('adds a global search provider with the same rules, only while the module is on', async () => {
		expect(await found('webby', 'zebra')).toEqual(['Zebra css', 'Zebra deploy', 'Zebra welcome']);
		expect(await found('sally', 'zebra')).toEqual(['Zebra parking', 'Zebra quota', 'Zebra welcome']);
		expect(await found('hr', 'zebra draft')).toEqual(['Zebra draft']);
		expect(await found('hrB', 'zebra')).toEqual([]);
		await saveModules(
			systemCtx(a.id),
			MODULE_IDS.filter((m) => MODULES[m].on && m !== 'knowledge')
		);
		expect(await found('webby', 'zebra')).toEqual([]);
		await saveModules(
			systemCtx(a.id),
			MODULE_IDS.filter((m) => MODULES[m].on)
		);
	});
});

describe('managing', () => {
	it('lets only knowledge base managers write', async () => {
		await expect(folder('webby', { name: 'Mine' })).rejects.toMatchObject({ status: 403 });
		await expect(article('webby', { title: 'Mine' })).rejects.toMatchObject({ status: 403 });
		await expect(deleteArticle(who.webby, { articleId: ids.welcome })).rejects.toMatchObject({ status: 403 });
		await expect(deleteFolder(who.webby, { folderId: ids.handbook })).rejects.toMatchObject({ status: 403 });
	});

	it('checks every id and value before writing', async () => {
		await expect(
			folder('hr', { name: 'Ghost', audience: 'department', departmentId: randomUUID() })
		).rejects.toMatchObject({ status: 400, code: 'invalid_department' });
		await expect(folder('hr', { name: 'Ghost', audience: 'department' })).rejects.toThrow('Choose the department.');
		await expect(folder('hr', { name: 'Ghost', parentId: randomUUID() })).rejects.toMatchObject({ status: 400 });
		await expect(article('hr', { title: 'Ghost', folderId: randomUUID() })).rejects.toMatchObject({
			code: 'invalid_folder'
		});
		await expect(article('hr', { title: 'Big', bodyMd: 'x'.repeat(KB.body + 1) })).rejects.toThrow(
			'Keep the article under'
		);
		await expect(article('hr', { title: 'Nul', bodyMd: 'a\0b' })).rejects.toThrow('hidden characters');
		await expect(article('hr', { title: 'Odd', status: 'archived' })).rejects.toThrow('Choose draft or published.');
		await expect(
			saveArticle(who.hr, { articleId: randomUUID(), title: 'Gone', status: 'draft' })
		).rejects.toMatchObject({ status: 404 });
	});

	it('stores line endings as plain newlines and moves an article between folders', async () => {
		const id = await article('hr', { title: 'Zebra moves', bodyMd: 'one\r\ntwo' });
		await saveArticle(who.hr, {
			articleId: id,
			folderId: ids.handbook,
			title: 'Zebra moves',
			bodyMd: 'one\r\ntwo',
			status: 'published'
		});
		const p = await open('hr', id);
		expect([p?.article.bodyMd, p?.article.folderId]).toEqual(['one\ntwo', ids.handbook]);
		expect(await deleteArticle(who.hr, { articleId: id })).toBe(ids.handbook);
	});

	it('refuses a twin name in the same place, ignoring case, but allows it elsewhere', async () => {
		await expect(folder('hr', { name: 'handbook' })).rejects.toMatchObject({ status: 409, code: 'name_exists' });
		const twin = await folder('hr', { name: 'Handbook', parentId: ids.engineering });
		await expect(
			folder('hr', { folderId: ids.office, name: 'HANDBOOK', audience: 'branch', branchId: ids.dhaka })
		).rejects.toMatchObject({ status: 409 });
		expect(await deleteFolder(who.hr, { folderId: twin })).toBe(ids.engineering);
	});

	it('refuses control characters in titles and folder names instead of failing in the database', async () => {
		for (const bad of ['a\0b', 'a\nb'] as const) {
			await expect(article('hr', { title: bad })).rejects.toThrow('hidden characters from the title');
			await expect(folder('hr', { name: bad })).rejects.toThrow('hidden characters from the folder name');
		}
	});

	it('caps the articles in one folder, counting moves but not edits in place', async () => {
		const was = KB.perFolder;
		KB.perFolder = 2;
		try {
			const box = await folder('hr', { name: 'Small box' });
			const first = await article('hr', { title: 'Box one', folderId: box });
			await article('hr', { title: 'Box two', folderId: box });
			await expect(article('hr', { title: 'Box three', folderId: box })).rejects.toMatchObject({
				status: 409,
				code: 'folder_full'
			});
			await expect(
				saveArticle(who.hr, { articleId: ids.welcome, folderId: box, title: 'Zebra welcome', status: 'published' })
			).rejects.toMatchObject({ code: 'folder_full' });
			await saveArticle(who.hr, { articleId: first, folderId: box, title: 'Box one again', status: 'published' });
			expect((await names('hr', box))!.articles).toEqual(['Box one again', 'Box two']);
		} finally {
			KB.perFolder = was;
		}
	});

	it('says when a search shows only the first matches', async () => {
		const was = KB.results;
		KB.results = 1;
		try {
			const p = await page('webby', null, 'zebra');
			expect([p!.articles.length, p!.more]).toEqual([1, true]);
			expect((await page('webby', null, 'tuesday'))!.more).toBe(false);
		} finally {
			KB.results = was;
		}
	});

	it('limits nesting depth', async () => {
		let parent = ids.handbook;
		for (let level = 2; level <= KB.depth; level++)
			parent = await folder('hr', { name: `Level ${level}`, parentId: parent });
		await expect(folder('hr', { name: 'Too deep', parentId: parent })).rejects.toMatchObject({ code: 'too_deep' });
	});

	it('deletes only empty folders', async () => {
		await expect(deleteFolder(who.hr, { folderId: ids.engineering })).rejects.toMatchObject({
			status: 409,
			code: 'not_empty'
		});
		const empty = await folder('hr', { name: 'Empty' });
		expect(await deleteFolder(who.hr, { folderId: empty })).toBeNull();
		await expect(deleteFolder(who.hr, { folderId: empty })).rejects.toMatchObject({ status: 404 });
	});

	it('never records the article text in the audit log', async () => {
		const rows = await sql()<{ v: Record<string, unknown> | null }[]>`
			select new_values as v from audit_log where tenant_id = ${a.id} and table_name = 'kb_articles' and row_id = ${ids.deploy}`;
		expect(rows.length).toBeGreaterThan(0);
		for (const r of rows) expect(JSON.stringify(r.v)).not.toContain('Tuesday');
	});
});

describe('other tenants', () => {
	it('never shows or touches another tenant folder or article', async () => {
		expect(await names('hrB')).toEqual({ folders: [], articles: [] });
		expect(await names('hrB', ids.handbook)).toBeNull();
		expect(await open('hrB', ids.welcome)).toBeNull();
		await expect(article('hrB', { title: 'Sneak', folderId: ids.handbook })).rejects.toMatchObject({
			code: 'invalid_folder'
		});
		await expect(folder('hrB', { name: 'Sneak', parentId: ids.handbook })).rejects.toMatchObject({ status: 400 });
		await expect(
			saveArticle(who.hrB, { articleId: ids.welcome, title: 'Owned', status: 'published' })
		).rejects.toMatchObject({ status: 404 });
		await expect(deleteFolder(who.hrB, { folderId: ids.office })).rejects.toMatchObject({ status: 404 });
		await expect(deleteArticle(who.hrB, { articleId: ids.welcome })).rejects.toMatchObject({ status: 404 });
		expect((await open('hr', ids.welcome))?.article.title).toBe('Zebra welcome');
	});
});
