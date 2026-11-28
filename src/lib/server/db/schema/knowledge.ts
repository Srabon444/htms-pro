import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { citext, tenantBase, tenantKey, tfk, trigramIndex } from './_helpers';
import { branches, departments } from './org';

export const KB_AUDIENCES = ['all', 'department', 'branch'] as const;
export const KB_STATUSES = ['draft', 'published'] as const;

export const kbFolders = pgTable(
	'kb_folders',
	{
		...tenantBase(),
		parentId: uuid(),
		name: citext().notNull(),
		audience: text({ enum: KB_AUDIENCES }).notNull().default('all'),
		departmentId: uuid(),
		branchId: uuid(),
		createdByUserId: uuid()
	},
	(t) => [
		tenantKey('kb_folders', t),
		tfk('kb_folders_parent_fk', t, t.parentId, t),
		tfk('kb_folders_department_fk', t, t.departmentId, departments),
		tfk('kb_folders_branch_fk', t, t.branchId, branches),
		unique('kb_folders_name_uq').on(t.tenantId, t.parentId, t.name).nullsNotDistinct(),
		index('kb_folders_parent_idx').on(t.tenantId, t.parentId),
		check('kb_folders_name_ck', sql`length(trim(${t.name})) between 1 and 80`),
		check('kb_folders_parent_ck', sql`${t.parentId} <> ${t.id}`),
		check(
			'kb_folders_audience_ck',
			sql`(${t.audience} = 'all' and ${t.departmentId} is null and ${t.branchId} is null) or (${t.audience} = 'department' and ${t.departmentId} is not null and ${t.branchId} is null) or (${t.audience} = 'branch' and ${t.branchId} is not null and ${t.departmentId} is null)`
		)
	]
);

export const kbArticles = pgTable(
	'kb_articles',
	{
		...tenantBase(),
		folderId: uuid(),
		title: text().notNull(),
		bodyMd: text().notNull().default(''),
		status: text({ enum: KB_STATUSES }).notNull().default('draft'),
		createdByUserId: uuid(),
		updatedByUserId: uuid()
	},
	(t) => [
		tenantKey('kb_articles', t),
		tfk('kb_articles_folder_fk', t, t.folderId, kbFolders),
		index('kb_articles_folder_idx').on(t.tenantId, t.folderId, t.title),
		trigramIndex('kb_articles_search_idx', t, t.title, t.bodyMd),
		check('kb_articles_title_ck', sql`length(trim(${t.title})) between 1 and 160`),
		check('kb_articles_body_ck', sql`length(${t.bodyMd}) <= 50000`),
		check('kb_articles_status_ck', sql`${t.status} in ('draft', 'published')`)
	]
);
