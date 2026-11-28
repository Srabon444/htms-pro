import { sql } from 'drizzle-orm';
import { check, date, doublePrecision, index, jsonb, pgTable, smallint, text, unique, uuid } from 'drizzle-orm/pg-core';
import { tenantBase, tenantKey, tfk, tstz } from './_helpers';
import { branches, departments, employees } from './org';

export const FORM_FIELD_KINDS = [
	'text',
	'number',
	'date',
	'select',
	'multi',
	'checkbox',
	'photo',
	'file',
	'acknowledge'
] as const;
export const FORM_STATUSES = ['draft', 'published', 'archived'] as const;
export const FORM_AUDIENCES = ['all', 'department', 'branch', 'employee'] as const;
export const FORM_SCHEDULES = ['once', 'daily', 'weekly'] as const;
export const MAX_FORM_FIELDS = 30;

export type FormField = {
	id: string;
	kind: (typeof FORM_FIELD_KINDS)[number];
	label: string;
	required: boolean;
	options: string[];
};
export type FormAnswer = string | number | boolean | string[] | null;

export const forms = pgTable(
	'forms',
	{
		...tenantBase(),
		title: text().notNull(),
		description: text(),
		fields: jsonb().$type<FormField[]>().notNull().default([]),
		status: text({ enum: FORM_STATUSES }).notNull().default('draft'),
		createdByUserId: uuid().notNull()
	},
	(t) => [
		tenantKey('forms', t),
		check('forms_title_ck', sql`length(trim(${t.title})) between 1 and 120`),
		check('forms_description_ck', sql`${t.description} is null or length(${t.description}) <= 1000`),
		check(
			'forms_fields_ck',
			sql`jsonb_typeof(${t.fields}) = 'array' and jsonb_array_length(${t.fields}) <= ${sql.raw(String(MAX_FORM_FIELDS))}`
		),
		check('forms_status_ck', sql`${t.status} in ('draft','published','archived')`)
	]
);

export const formAssignments = pgTable(
	'form_assignments',
	{
		...tenantBase(),
		formId: uuid().notNull(),
		audience: text({ enum: FORM_AUDIENCES }).notNull(),
		departmentId: uuid(),
		branchId: uuid(),
		employeeId: uuid(),
		schedule: text({ enum: FORM_SCHEDULES }).notNull(),
		weekday: smallint(),
		remindHour: smallint().notNull(),
		startsOn: date().notNull(),
		endsOn: date(),
		createdByUserId: uuid().notNull()
	},
	(t) => [
		tenantKey('form_assignments', t),
		tfk('form_assignments_form_fk', t, t.formId, forms, 'cascade'),
		tfk('form_assignments_department_fk', t, t.departmentId, departments, 'cascade'),
		tfk('form_assignments_branch_fk', t, t.branchId, branches, 'cascade'),
		tfk('form_assignments_employee_fk', t, t.employeeId, employees, 'cascade'),
		index('form_assignments_form_idx').on(t.tenantId, t.formId),
		check('form_assignments_audience_ck', sql`${t.audience} in ('all','department','branch','employee')`),
		check(
			'form_assignments_target_ck',
			sql`(${t.departmentId} is not null) = (${t.audience} = 'department') and (${t.branchId} is not null) = (${t.audience} = 'branch') and (${t.employeeId} is not null) = (${t.audience} = 'employee')`
		),
		check('form_assignments_schedule_ck', sql`${t.schedule} in ('once','daily','weekly')`),
		check(
			'form_assignments_weekday_ck',
			sql`(${t.weekday} is not null) = (${t.schedule} = 'weekly') and (${t.weekday} is null or ${t.weekday} between 0 and 6)`
		),
		check('form_assignments_hour_ck', sql`${t.remindHour} between 0 and 23`),
		check('form_assignments_dates_ck', sql`${t.endsOn} is null or ${t.endsOn} >= ${t.startsOn}`)
	]
);

export const formSubmissions = pgTable(
	'form_submissions',
	{
		...tenantBase(),
		formId: uuid().notNull(),
		assignmentId: uuid().notNull(),
		employeeId: uuid().notNull(),
		period: date().notNull(),
		answers: jsonb().$type<Record<string, FormAnswer>>().notNull(),
		lat: doublePrecision(),
		lng: doublePrecision(),
		submittedByUserId: uuid().notNull()
	},
	(t) => [
		tenantKey('form_submissions', t),
		tfk('form_submissions_form_fk', t, t.formId, forms, 'cascade'),
		tfk('form_submissions_assignment_fk', t, t.assignmentId, formAssignments, 'cascade'),
		tfk('form_submissions_employee_fk', t, t.employeeId, employees, 'cascade'),
		unique('form_submissions_period_uq').on(t.tenantId, t.formId, t.employeeId, t.period),
		index('form_submissions_form_idx').on(t.tenantId, t.formId, t.createdAt),
		index('form_submissions_employee_idx').on(t.tenantId, t.employeeId, t.createdAt),
		check('form_submissions_answers_ck', sql`jsonb_typeof(${t.answers}) = 'object'`),
		check(
			'form_submissions_location_ck',
			sql`(${t.lat} is null) = (${t.lng} is null) and (${t.lat} is null or (${t.lat} between -90 and 90 and ${t.lng} between -180 and 180))`
		)
	]
);

export const TASK_STATUSES = ['open', 'done'] as const;

export const tasks = pgTable(
	'tasks',
	{
		...tenantBase(),
		title: text().notNull(),
		description: text(),
		assigneeEmployeeId: uuid().notNull(),
		dueOn: date(),
		status: text({ enum: TASK_STATUSES }).notNull().default('open'),
		createdByUserId: uuid().notNull(),
		doneAt: tstz()
	},
	(t) => [
		tenantKey('tasks', t),
		tfk('tasks_assignee_fk', t, t.assigneeEmployeeId, employees, 'cascade'),
		index('tasks_assignee_idx').on(t.tenantId, t.assigneeEmployeeId, t.status),
		index('tasks_creator_idx').on(t.tenantId, t.createdByUserId, t.status),
		check('tasks_title_ck', sql`length(trim(${t.title})) between 1 and 200`),
		check('tasks_description_ck', sql`${t.description} is null or length(${t.description}) <= 2000`),
		check('tasks_status_ck', sql`${t.status} in ('open','done')`),
		check('tasks_done_ck', sql`(${t.status} = 'done') = (${t.doneAt} is not null)`)
	]
);
