import { and, asc, count, desc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { audienceFilter } from './announcements';
import { containsPattern } from './db/like';
import { pgCode, UNIQUE_VIOLATION } from './db/errors';
import { branches, departments, KB_AUDIENCES, KB_STATUSES, kbArticles, kbFolders, policies } from './db/schema';
import { AppError } from './errors';
import { scopesOf, userCtx, type Access, type requireMember } from './rbac/access';
import { withTenant, type Tx } from './tenancy';

type Member = ReturnType<typeof requireMember>;

const plain = (v: string) => !/\p{Cc}/u.test(v);
const searchText = z.string().trim().min(2).max(80).refine(plain);

export const KB = { folders: 200, depth: 4, perFolder: 200, results: 50, body: 50_000 };

const optionalId = z
	.union([z.literal(''), z.uuid()])
	.transform((v) => v || null)
	.prefault('');

const folderSchema = z
	.object({
		folderId: optionalId,
		parentId: optionalId,
		name: z
			.string()
			.trim()
			.min(1, 'Name the folder.')
			.max(80, 'Keep the folder name under 80 characters.')
			.refine(plain, 'Remove the hidden characters from the folder name.'),
		audience: z.enum(KB_AUDIENCES, 'Choose who can open the folder.'),
		departmentId: optionalId,
		branchId: optionalId
	})
	.refine((v) => v.audience !== 'department' || v.departmentId, { message: 'Choose the department.' })
	.refine((v) => v.audience !== 'branch' || v.branchId, { message: 'Choose the branch.' })
	.transform((v) => ({
		...v,
		departmentId: v.audience === 'department' ? v.departmentId : null,
		branchId: v.audience === 'branch' ? v.branchId : null
	}));

const articleSchema = z.object({
	articleId: optionalId,
	folderId: optionalId,
	title: z
		.string()
		.trim()
		.min(1, 'Add a title.')
		.max(160, 'Keep the title under 160 characters.')
		.refine(plain, 'Remove the hidden characters from the title.'),
	bodyMd: z
		.string()
		.max(KB.body, `Keep the article under ${KB.body} characters.`)
		.refine((v) => !v.includes('\0'), 'Remove the hidden characters from the article.')
		.transform((v) => v.replaceAll('\r\n', '\n'))
		.prefault(''),
	status: z.enum(KB_STATUSES, 'Choose draft or published.')
});

export const canRunKb = (access: Access) => scopesOf(access, 'kb.manage').includes('all');
const onlyManagers = (access: Access) => {
	if (!canRunKb(access)) throw new AppError('forbidden', 'Only people who manage the knowledge base can do that.', 403);
};
const folderGone = () => new AppError('not_found', 'That folder does not exist.', 404);
const articleGone = () => new AppError('not_found', 'That article does not exist.', 404);

type Folder = {
	id: string;
	parentId: string | null;
	name: string;
	audience: string;
	departmentId: string | null;
	branchId: string | null;
	target: string | null;
};

async function allFolders(tx: Tx): Promise<Folder[]> {
	return tx
		.select({
			id: kbFolders.id,
			parentId: kbFolders.parentId,
			name: kbFolders.name,
			audience: kbFolders.audience,
			departmentId: kbFolders.departmentId,
			branchId: kbFolders.branchId,
			target: sql<string | null>`coalesce(${departments.name}, ${branches.name})`
		})
		.from(kbFolders)
		.leftJoin(departments, eq(departments.id, kbFolders.departmentId))
		.leftJoin(branches, eq(branches.id, kbFolders.branchId))
		.orderBy(asc(kbFolders.name));
}

const chainOf = (byId: Map<string, Folder>, id: string | null) => {
	const chain: Folder[] = [];
	for (
		let f = id ? byId.get(id) : undefined;
		f && chain.length <= KB.depth;
		f = f.parentId ? byId.get(f.parentId) : undefined
	)
		chain.unshift(f);
	return chain;
};

export async function visibleFolders(tx: Tx, access: Access) {
	const folders = await allFolders(tx);
	const byId = new Map(folders.map((f) => [f.id, f]));
	if (canRunKb(access)) return byId;
	const open = new Set(
		(
			await tx
				.select({ id: kbFolders.id })
				.from(kbFolders)
				.where(await audienceFilter(tx, access.employeeId, kbFolders))
		).map((r) => r.id)
	);
	const seen = new Map<string, Folder>();
	for (const f of folders) {
		const chain = chainOf(byId, f.id);
		if (chain[0]?.parentId === null && chain.every((c) => open.has(c.id))) seen.set(f.id, f);
	}
	return seen;
}

const scopeFrom = (access: Access, folders: Map<string, Folder>) => {
	if (canRunKb(access)) return undefined;
	const ids = [...folders.keys()];
	return and(
		eq(kbArticles.status, 'published'),
		or(isNull(kbArticles.folderId), ids.length ? inArray(kbArticles.folderId, ids) : undefined)
	);
};

export const articleScope = async (tx: Tx, access: Access) => scopeFrom(access, await visibleFolders(tx, access));

export const excerpt = (md: string) =>
	md
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/^\s*>+/gm, '')
		.replace(/[#*_`]+/g, '')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 180);

const pathOf = (byId: Map<string, Folder>, id: string) =>
	chainOf(byId, id)
		.map((f) => f.name)
		.join(' / ');

export async function knowledgePage(tx: Tx, access: Access, input: { folder: string | null; q: string | null }) {
	const manager = canRunKb(access);
	const folders = await visibleFolders(tx, access);
	const folderId = input.folder && z.uuid().safeParse(input.folder).success ? input.folder : null;
	if (input.folder && (!folderId || !folders.has(folderId))) return null;
	const q = input.q ? searchText.safeParse(input.q) : null;
	const query = q?.success ? q.data : null;
	const scope = scopeFrom(access, folders);
	const limit = query ? KB.results : KB.perFolder;
	const rows = await tx
		.select({
			id: kbArticles.id,
			title: kbArticles.title,
			body: sql<string>`left(${kbArticles.bodyMd}, 600)`,
			status: kbArticles.status,
			folderId: kbArticles.folderId,
			updatedAt: kbArticles.updatedAt
		})
		.from(kbArticles)
		.where(
			and(
				scope,
				query
					? or(
							sql`${kbArticles.title} ilike ${containsPattern(query)}`,
							sql`${kbArticles.bodyMd} ilike ${containsPattern(query)}`
						)
					: folderId
						? eq(kbArticles.folderId, folderId)
						: isNull(kbArticles.folderId)
			)
		)
		.orderBy(
			query ? desc(sql`${kbArticles.title} ilike ${containsPattern(query)}`) : asc(kbArticles.title),
			asc(kbArticles.title)
		)
		.limit(limit + 1);
	const showPolicies = !folderId || !!query;
	const policyRows = showPolicies
		? await tx
				.select({ id: policies.id, title: policies.title, description: policies.description })
				.from(policies)
				.where(
					and(
						eq(policies.active, true),
						query
							? or(
									sql`${policies.title} ilike ${containsPattern(query)}`,
									sql`${policies.description} ilike ${containsPattern(query)}`
								)
							: undefined
					)
				)
				.orderBy(asc(policies.title))
				.limit(KB.results)
		: [];
	const all = [...folders.values()];
	return {
		manager,
		query,
		badQuery: !!input.q && !query,
		current: folderId ? folders.get(folderId)! : null,
		trail: chainOf(folders, folderId),
		children: query ? [] : all.filter((f) => f.parentId === folderId),
		more: rows.length > limit,
		articles: rows.slice(0, limit).map(({ body, ...r }) => ({
			...r,
			excerpt: excerpt(body),
			folder: r.folderId ? pathOf(folders, r.folderId) : null
		})),
		policies: policyRows,
		admin: manager ? await adminLists(tx, folders) : null
	};
}

async function adminLists(tx: Tx, folders: Map<string, Folder>) {
	const [d, b] = await Promise.all([
		tx.select({ id: departments.id, name: departments.name }).from(departments).orderBy(departments.name),
		tx.select({ id: branches.id, name: branches.name }).from(branches).orderBy(branches.name)
	]);
	const paths = [...folders.values()]
		.map((f) => ({ id: f.id, path: pathOf(folders, f.id), depth: chainOf(folders, f.id).length }))
		.sort((x, y) => x.path.localeCompare(y.path));
	return { departments: d, branches: b, folders: paths, full: folders.size >= KB.folders };
}

export async function articlePage(tx: Tx, access: Access, id: string) {
	if (!z.uuid().safeParse(id).success) return null;
	const folders = await visibleFolders(tx, access);
	const [row] = await tx
		.select()
		.from(kbArticles)
		.where(and(eq(kbArticles.id, id), scopeFrom(access, folders)));
	if (!row) return null;
	const manager = canRunKb(access);
	return {
		article: row,
		trail: chainOf(folders, row.folderId),
		manager,
		folders: manager ? (await adminLists(tx, folders)).folders : []
	};
}

const lockTree = (tx: Tx, tenantId: string) =>
	tx.execute(sql`select pg_advisory_xact_lock(hashtext('kb_folders:' || ${tenantId}))`);

async function checkAudience(tx: Tx, v: { departmentId: string | null; branchId: string | null }) {
	if (v.departmentId) {
		const [d] = await tx.select({ id: departments.id }).from(departments).where(eq(departments.id, v.departmentId));
		if (!d) throw new AppError('invalid_department', 'Choose an existing department.', 400);
	}
	if (v.branchId) {
		const [b] = await tx.select({ id: branches.id }).from(branches).where(eq(branches.id, v.branchId));
		if (!b) throw new AppError('invalid_branch', 'Choose an existing branch.', 400);
	}
}

const nameClash = (err: unknown): never => {
	if (pgCode(err) === UNIQUE_VIOLATION)
		throw new AppError('name_exists', 'Another folder in the same place already uses that name.', 409);
	throw err;
};

export async function saveFolder(m: Member, raw: Record<string, string>) {
	const { folderId, parentId, ...input } = folderSchema.parse(raw);
	onlyManagers(m.access);
	return withTenant(userCtx(m), async (tx) => {
		await lockTree(tx, m.tenant.id);
		await checkAudience(tx, input);
		if (folderId) {
			const [f] = await tx
				.update(kbFolders)
				.set(input)
				.where(eq(kbFolders.id, folderId))
				.returning({ id: kbFolders.id })
				.catch(nameClash);
			if (!f) throw folderGone();
			return f.id;
		}
		const folders = await allFolders(tx);
		if (folders.length >= KB.folders)
			throw new AppError('too_many', `The knowledge base can hold at most ${KB.folders} folders.`, 409);
		if (parentId) {
			const byId = new Map(folders.map((f) => [f.id, f]));
			if (!byId.has(parentId)) throw new AppError('invalid_parent', 'Choose an existing folder.', 400);
			if (chainOf(byId, parentId).length >= KB.depth)
				throw new AppError('too_deep', `Folders can be at most ${KB.depth} levels deep.`, 400);
		}
		const [f] = await tx
			.insert(kbFolders)
			.values({ tenantId: m.tenant.id, parentId, ...input, createdByUserId: m.user.userId })
			.returning({ id: kbFolders.id })
			.catch(nameClash);
		return f.id;
	});
}

export async function deleteFolder(m: Member, raw: Record<string, string>) {
	const id = z.uuid({ error: 'Choose a folder.' }).parse(raw.folderId);
	onlyManagers(m.access);
	return withTenant(userCtx(m), async (tx) => {
		await lockTree(tx, m.tenant.id);
		const [f] = await tx
			.select({ parentId: kbFolders.parentId })
			.from(kbFolders)
			.where(eq(kbFolders.id, id))
			.for('update');
		if (!f) throw folderGone();
		const [[sub], [docs]] = await Promise.all([
			tx.select({ n: count() }).from(kbFolders).where(eq(kbFolders.parentId, id)),
			tx.select({ n: count() }).from(kbArticles).where(eq(kbArticles.folderId, id))
		]);
		if (sub.n || docs.n)
			throw new AppError('not_empty', 'Move or delete the folders and articles inside it first.', 409);
		await tx.delete(kbFolders).where(eq(kbFolders.id, id));
		return f.parentId;
	});
}

export async function saveArticle(m: Member, raw: Record<string, string>) {
	const { articleId, ...input } = articleSchema.parse(raw);
	onlyManagers(m.access);
	return withTenant(userCtx(m), async (tx) => {
		await lockTree(tx, m.tenant.id);
		if (input.folderId) {
			const [f] = await tx.select({ id: kbFolders.id }).from(kbFolders).where(eq(kbFolders.id, input.folderId));
			if (!f) throw new AppError('invalid_folder', 'Choose an existing folder.', 400);
		}
		const [{ n }] = await tx
			.select({ n: count() })
			.from(kbArticles)
			.where(
				and(
					input.folderId ? eq(kbArticles.folderId, input.folderId) : isNull(kbArticles.folderId),
					articleId ? ne(kbArticles.id, articleId) : undefined
				)
			);
		if (n >= KB.perFolder)
			throw new AppError('folder_full', `A folder can hold at most ${KB.perFolder} articles. Use a sub-folder.`, 409);
		if (articleId) {
			const [a] = await tx
				.update(kbArticles)
				.set({ ...input, updatedByUserId: m.user.userId })
				.where(eq(kbArticles.id, articleId))
				.returning({ id: kbArticles.id });
			if (!a) throw articleGone();
			return a.id;
		}
		const [a] = await tx
			.insert(kbArticles)
			.values({ tenantId: m.tenant.id, ...input, createdByUserId: m.user.userId, updatedByUserId: m.user.userId })
			.returning({ id: kbArticles.id });
		return a.id;
	});
}

export async function deleteArticle(m: Member, raw: Record<string, string>) {
	const id = z.uuid({ error: 'Choose an article.' }).parse(raw.articleId);
	onlyManagers(m.access);
	return withTenant(userCtx(m), async (tx) => {
		const [a] = await tx.delete(kbArticles).where(eq(kbArticles.id, id)).returning({ folderId: kbArticles.folderId });
		if (!a) throw articleGone();
		return a.folderId;
	});
}
