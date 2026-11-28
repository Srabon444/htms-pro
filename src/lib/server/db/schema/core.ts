import { sql } from 'drizzle-orm';
import {
	bigint,
	boolean,
	check,
	foreignKey,
	index,
	integer,
	jsonb,
	pgTable,
	smallint,
	text,
	time,
	unique,
	uuid
} from 'drizzle-orm/pg-core';
import { citext, createdAt, tenantBase, tenantKey, tfk, tstz, updatedAt } from './_helpers';
import { LIMITS } from '../../../settings-sections';
import { employees } from './org';
import { tenants } from './tenants';
export { tenants } from './tenants';

export const users = pgTable(
	'users',
	{
		id: uuid().primaryKey().defaultRandom(),
		email: citext().notNull().unique(),
		passwordHash: text().notNull(),
		name: text().notNull(),
		isPlatformAdmin: boolean().notNull().default(false),
		totpSecretEnc: text(),
		totpEnabled: boolean().notNull().default(false),
		totpLastStep: bigint({ mode: 'number' }),
		recoveryCodes: jsonb()
			.$type<string[]>()
			.notNull()
			.default(sql`'[]'::jsonb`),
		googleSub: text().unique(),
		status: text().notNull().default('active'),
		lastLoginAt: tstz(),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [check('users_status_ck', sql`${t.status} in ('active','disabled')`)]
);

export const sessions = pgTable(
	'sessions',
	{
		id: text().primaryKey(),
		userId: uuid()
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		expiresAt: tstz().notNull(),
		idleExpiresAt: tstz().notNull(),
		lastSeenAt: tstz().notNull().defaultNow(),
		reauthAt: tstz(),
		ssoTenantId: uuid().references(() => tenants.id, { onDelete: 'cascade' }),
		ip: text(),
		userAgent: text(),
		createdAt: createdAt()
	},
	(t) => [index('sessions_user_idx').on(t.userId)]
);

export const passwordResets = pgTable('password_resets', {
	tokenHash: text().primaryKey(),
	userId: uuid()
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	expiresAt: tstz().notNull(),
	usedAt: tstz(),
	createdAt: createdAt()
});

export const platformAudit = pgTable('platform_audit', {
	id: uuid().primaryKey().defaultRandom(),
	actorUserId: uuid(),
	action: text().notNull(),
	target: text(),
	meta: jsonb()
		.notNull()
		.default(sql`'{}'::jsonb`),
	ip: text(),
	createdAt: createdAt()
});

export const memberships = pgTable(
	'memberships',
	{
		...tenantBase(),
		userId: uuid()
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		employeeId: uuid(),
		status: text().notNull().default('active'),
		exAccessUntil: tstz(),
		lastUsedAt: tstz(),
		disabledBy: text().$type<'hr' | 'scim' | 'exit'>()
	},
	(t) => [
		tenantKey('memberships', t),
		unique('memberships_tenant_user_uq').on(t.tenantId, t.userId),
		unique('memberships_tenant_employee_uq').on(t.tenantId, t.employeeId),
		tfk('memberships_employee_fk', t, t.employeeId, employees, 'restrict'),
		index('memberships_user_idx').on(t.userId),
		check('memberships_status_ck', sql`${t.status} in ('active','ex_employee','disabled')`),
		check('memberships_disabled_by_ck', sql`${t.disabledBy} is null or ${t.disabledBy} in ('hr','scim','exit')`)
	]
);

export const roles = pgTable(
	'roles',
	{
		...tenantBase(),
		key: text().notNull(),
		name: text().notNull(),
		description: text(),
		isSystem: boolean().notNull().default(false),
		locked: boolean().notNull().default(false)
	},
	(t) => [tenantKey('roles', t), unique('roles_tenant_key_uq').on(t.tenantId, t.key)]
);

export const rolePermissions = pgTable(
	'role_permissions',
	{
		...tenantBase(),
		roleId: uuid().notNull(),
		permission: text().notNull(),
		scope: text().notNull()
	},
	(t) => [
		tenantKey('role_permissions', t),
		tfk('role_permissions_role_fk', t, t.roleId, roles, 'cascade'),
		unique('role_permissions_uq').on(t.tenantId, t.roleId, t.permission, t.scope),
		check('role_permissions_scope_ck', sql`${t.scope} in ('own','team','department','all')`)
	]
);

export const systemGrants = pgTable(
	'system_grants',
	{
		...tenantBase(),
		roleKey: text().notNull(),
		permission: text().notNull(),
		scope: text().notNull()
	},
	(t) => [tenantKey('system_grants', t), unique('system_grants_uq').on(t.tenantId, t.roleKey, t.permission, t.scope)]
);

export const membershipRoles = pgTable(
	'membership_roles',
	{
		...tenantBase(),
		membershipId: uuid().notNull(),
		roleId: uuid().notNull()
	},
	(t) => [
		tenantKey('membership_roles', t),
		tfk('membership_roles_membership_fk', t, t.membershipId, memberships, 'cascade'),
		tfk('membership_roles_role_fk', t, t.roleId, roles, 'cascade'),
		unique('membership_roles_uq').on(t.tenantId, t.membershipId, t.roleId)
	]
);

export const invitations = pgTable(
	'invitations',
	{
		...tenantBase(),
		email: citext().notNull(),
		tokenHash: text().notNull().unique(),
		roleIds: uuid()
			.array()
			.notNull()
			.default(sql`'{}'::uuid[]`),
		employeeId: uuid(),
		invitedByMembershipId: uuid(),
		expiresAt: tstz().notNull(),
		acceptedAt: tstz(),
		revokedAt: tstz()
	},
	(t) => [
		tenantKey('invitations', t),
		index('invitations_tenant_email_idx').on(t.tenantId, t.email),
		tfk('invitations_employee_fk', t, t.employeeId, employees, 'restrict')
	]
);

export const tenantSettings = pgTable(
	'tenant_settings',
	{
		...tenantBase(),
		legalName: text(),
		logoFileId: uuid(),
		address: text(),
		currency: text().notNull().default('USD'),
		timezone: text().notNull().default('UTC'),
		fiscalYearStartMonth: smallint().notNull().default(1),
		weekendDays: smallint()
			.array()
			.notNull()
			.default(sql`'{0,6}'::smallint[]`),
		payrollProrationBasis: text().notNull().default('calendar'),
		mealPayrollLagMonths: smallint().notNull().default(1),
		latePolicyCount: smallint().notNull().default(0),
		latePolicyPenalty: text().notNull().default('lop'),
		require2faForSensitive: boolean().notNull().default(false),
		allowSingleAdminApproval: boolean().notNull().default(false),
		payslipEmailPdf: boolean().notNull().default(false),
		retentionCandidatesDays: integer().notNull().default(365),
		retentionTicketsDays: integer().notNull().default(730),
		retentionAuditDays: integer().notNull().default(730),
		exEmployeeAccessDays: integer().notNull().default(90),
		employeeCodePrefix: text().notNull().default('EMP-'),
		noticePeriodDays: integer().notNull().default(30),
		overtimeDailyCapMinutes: smallint().notNull().default(120),
		compOffExpiryDays: smallint().notNull().default(90),
		mealCutoffTime: time().notNull().default('10:00'),
		mealMode: text().notNull().default('opt_out'),
		mealWorkingDaysOnly: boolean().notNull().default(true),
		mealBillingMode: text().notNull().default('payroll'),
		pfEmployeeRateBp: smallint().notNull().default(0),
		pfEmployerRateBp: smallint().notNull().default(0),
		overtimeRateBp: integer().notNull().default(0),
		overtimeMonthlyHours: smallint().notNull().default(208),
		bonusRateBp: integer().notNull().default(10_000),
		bonusMinServiceMonths: smallint().notNull().default(0),
		arrearsLookbackMonths: smallint().notNull().default(12),
		gratuityDaysPerYear: smallint().notNull().default(30),
		gratuityMinYears: smallint().notNull().default(5),
		pfVestingMonths: smallint().notNull().default(24),
		probationAlertDays: smallint().notNull().default(30),
		documentExpiryAlertDays: smallint().notNull().default(30),
		upcomingHireDays: smallint().notNull().default(14),
		mealOrderDaysAhead: smallint().notNull().default(14),
		referralQualifyDays: smallint().notNull().default(90),
		loanMaxInstalments: smallint().notNull().default(60),
		invitationValidDays: smallint().notNull().default(7),
		reportShareDays: smallint().notNull().default(30),
		modulesEnabled: text()
			.array()
			.notNull()
			.default(sql`'{}'::text[]`),
		modulesDisabled: text()
			.array()
			.notNull()
			.default(sql`'{}'::text[]`),
		punchLocationRule: text().notNull().default('off'),
		kudosValues: text()
			.array()
			.notNull()
			.default(sql`'{}'::text[]`)
	},
	(t) => [
		tenantKey('tenant_settings', t),
		unique('tenant_settings_tenant_uq').on(t.tenantId),
		check('tenant_settings_fy_ck', sql`${t.fiscalYearStartMonth} between 1 and 12`),
		check('tenant_settings_notice_ck', sql`${t.noticePeriodDays} between 0 and 365`),
		check('tenant_settings_basis_ck', sql`${t.payrollProrationBasis} in ('calendar','working')`),
		check('tenant_settings_late_ck', sql`${t.latePolicyPenalty} in ('lop','leave')`),
		check('tenant_settings_punch_rule_ck', sql`${t.punchLocationRule} in ('off','flag','block')`),
		check('tenant_settings_lag_ck', sql`${t.mealPayrollLagMonths} between 0 and 3`),
		check('tenant_settings_audit_ret_ck', sql`${t.retentionAuditDays} >= 365`),
		check('tenant_settings_candidates_ret_ck', sql`${t.retentionCandidatesDays} between 30 and 3650`),
		check('tenant_settings_overtime_ck', sql`${t.overtimeDailyCapMinutes} between 15 and 720`),
		check('tenant_settings_comp_off_ck', sql`${t.compOffExpiryDays} between 1 and 365`),
		check('tenant_settings_meal_mode_ck', sql`${t.mealMode} in ('opt_out','opt_in')`),
		check('tenant_settings_meal_billing_ck', sql`${t.mealBillingMode} in ('payroll','direct')`),
		check(
			'tenant_settings_pf_ck',
			sql`${t.pfEmployeeRateBp} between 0 and 5000 and ${t.pfEmployerRateBp} between 0 and 5000`
		),
		check(
			'tenant_settings_ot_pay_ck',
			sql`${t.overtimeRateBp} between 0 and 50000 and ${t.overtimeMonthlyHours} between 1 and 744`
		),
		check('tenant_settings_late_count_ck', sql`${t.latePolicyCount} between 0 and 31`),
		check(
			'tenant_settings_bonus_ck',
			sql`${t.bonusRateBp} between 0 and 50000 and ${t.bonusMinServiceMonths} between 0 and 120`
		),
		check('tenant_settings_arrears_ck', sql`${t.arrearsLookbackMonths} between 1 and 24`),
		check(
			'tenant_settings_settlement_ck',
			sql`${t.gratuityDaysPerYear} between 0 and 90 and ${t.gratuityMinYears} between 0 and 40 and ${t.pfVestingMonths} between 0 and 120`
		),
		...(
			[
				'probationAlertDays',
				'documentExpiryAlertDays',
				'upcomingHireDays',
				'mealOrderDaysAhead',
				'referralQualifyDays',
				'loanMaxInstalments',
				'invitationValidDays',
				'reportShareDays'
			] as const
		).map((k) =>
			check(
				`tenant_settings_${k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)}_ck`,
				sql`${t[k]} between ${sql.raw(String(LIMITS[k].min))} and ${sql.raw(String(LIMITS[k].max))}`
			)
		)
	]
);

export const counters = pgTable(
	'counters',
	{
		...tenantBase(),
		name: text().notNull(),
		value: bigint({ mode: 'number' }).notNull().default(0)
	},
	(t) => [tenantKey('counters', t), unique('counters_tenant_name_uq').on(t.tenantId, t.name)]
);

export const auditLog = pgTable(
	'audit_log',
	{
		...tenantBase(),
		actorUserId: uuid(),
		actorKind: text().notNull().default('user'),
		tableName: text().notNull(),
		rowId: uuid(),
		op: text().notNull(),
		changedColumns: text()
			.array()
			.notNull()
			.default(sql`'{}'::text[]`),
		oldValues: jsonb(),
		newValues: jsonb(),
		event: text()
	},
	(t) => [
		tenantKey('audit_log', t),
		index('audit_log_tenant_created_idx').on(t.tenantId, t.createdAt),
		index('audit_log_tenant_row_idx').on(t.tenantId, t.tableName, t.rowId),
		index('audit_log_actor_idx').on(t.tenantId, t.actorUserId, t.createdAt, t.id)
	]
);

export const auditSensitive = pgTable(
	'audit_sensitive',
	{
		...tenantBase(),
		auditId: uuid().notNull(),
		oldValues: jsonb(),
		newValues: jsonb()
	},
	(t) => [
		tenantKey('audit_sensitive', t),
		foreignKey({ name: 'audit_sensitive_audit_fk', columns: [t.auditId], foreignColumns: [auditLog.id] }).onDelete(
			'cascade'
		),
		index('audit_sensitive_audit_idx').on(t.tenantId, t.auditId)
	]
);

export const notifications = pgTable(
	'notifications',
	{
		...tenantBase(),
		membershipId: uuid().notNull(),
		category: text().notNull(),
		title: text().notNull(),
		body: text(),
		link: text(),
		readAt: tstz()
	},
	(t) => [
		tenantKey('notifications', t),
		tfk('notifications_membership_fk', t, t.membershipId, memberships, 'cascade'),
		index('notifications_member_idx').on(t.tenantId, t.membershipId, t.readAt)
	]
);

export const notificationPrefs = pgTable(
	'notification_prefs',
	{
		...tenantBase(),
		membershipId: uuid().notNull(),
		category: text().notNull(),
		email: boolean().notNull().default(true)
	},
	(t) => [
		tenantKey('notification_prefs', t),
		tfk('notification_prefs_membership_fk', t, t.membershipId, memberships, 'cascade'),
		unique('notification_prefs_uq').on(t.tenantId, t.membershipId, t.category)
	]
);

export const ATTACHMENT_OWNERS = [
	'leave_request',
	'ticket',
	'resignation',
	'asset',
	'candidate',
	'offer',
	'interview_feedback',
	'checklist_item',
	'change_request',
	'attendance_request',
	'loan',
	'ticket_comment',
	'announcement',
	'salary_change',
	'review',
	'goal',
	'project',
	'meal_bill',
	'education',
	'experience',
	'course_lesson',
	'certification',
	'form_submission'
] as const;
export type AttachmentOwner = (typeof ATTACHMENT_OWNERS)[number];
export const MAX_ATTACHMENTS = 5;

export const files = pgTable(
	'files',
	{
		...tenantBase(),
		key: text().notNull(),
		filename: text().notNull(),
		mime: text().notNull(),
		size: integer().notNull(),
		sha256: text().notNull(),
		ownerType: text().notNull(),
		ownerId: uuid().notNull(),
		uploadedByUserId: uuid()
	},
	(t) => [
		tenantKey('files', t),
		unique('files_key_uq').on(t.key),
		index('files_owner_idx').on(t.tenantId, t.ownerType, t.ownerId),
		check('files_size_ck', sql`${t.size} > 0`),
		check('files_owner_type_ck', sql`${t.ownerType} in (${sql.raw(ATTACHMENT_OWNERS.map((o) => `'${o}'`).join(','))})`)
	]
);
