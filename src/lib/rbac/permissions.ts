export const PERMISSIONS = [
	'employee.read',
	'employee.create',
	'employee.update',
	'employee.delete',
	'employee.sensitive.read',
	'employee.sensitive.update',
	'document.read',
	'document.manage',
	'org.manage',
	'settings.manage',
	'attendance.read',
	'attendance.punch',
	'attendance.manage',
	'attendance.approve',
	'schedule.read',
	'schedule.manage',
	'schedule.approve',
	'schedule.swap',
	'leave.read',
	'leave.request',
	'leave.approve',
	'leave.manage',
	'payroll.read',
	'payroll.run',
	'payroll.approve',
	'salary.read',
	'salary.update',
	'salary.approve',
	'comp.propose',
	'comp.manage',
	'loan.request',
	'loan.approve',
	'travel.request',
	'travel.approve',
	'travel.manage',
	'travel.read',
	'form.manage',
	'form.read',
	'meal.order',
	'meal.manage',
	'meal.billing',
	'recruitment.read',
	'recruitment.manage',
	'interview.feedback',
	'performance.read',
	'performance.review',
	'performance.manage',
	'project.read',
	'project.manage',
	'timesheet.submit',
	'timesheet.approve',
	'workplan.edit',
	'expense.submit',
	'expense.approve',
	'expense.pay',
	'asset.read',
	'asset.manage',
	'helpdesk.submit',
	'helpdesk.manage',
	'helpdesk.confidential',
	'announcement.manage',
	'policy.manage',
	'kb.manage',
	'letter.issue',
	'report.headcount',
	'report.attendance',
	'report.leave',
	'report.payroll',
	'report.meal',
	'report.recruitment',
	'report.expense',
	'report.utilisation',
	'report.weekly',
	'user.manage',
	'role.manage',
	'audit.read',
	'audit.sensitive',
	'data.export',
	'directory.read',
	'calendar.read',
	'event.manage',
	'survey.manage',
	'kudos.moderate',
	'skill.manage',
	'skill.validate',
	'course.manage',
	'course.report',
	'signature.manage',
	'ai.use',
	'ai.manage',
	'api.manage',
	'sso.manage'
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const SCOPES = ['own', 'team', 'department', 'all'] as const;

export type Scope = (typeof SCOPES)[number];

export const isScopeValue = (value: string): value is Scope => (SCOPES as readonly string[]).includes(value);

export type Grant = readonly [Permission, Scope];

const RESTRICTED_PREFIXES = ['payroll.', 'salary.', 'audit.', 'employee.sensitive.'];
const RESTRICTED_EXACT = new Set<Permission>([
	'role.manage',
	'user.manage',
	'settings.manage',
	'data.export',
	'ai.manage',
	'api.manage',
	'sso.manage',
	'comp.manage'
]);

export const isRestricted = (p: Permission): boolean =>
	RESTRICTED_EXACT.has(p) || RESTRICTED_PREFIXES.some((prefix) => p.startsWith(prefix));

export const isPermission = (value: string): value is Permission => (PERMISSIONS as readonly string[]).includes(value);

const at = (scope: Scope, ...perms: Permission[]): Grant[] => perms.map((p) => [p, scope] as const);

export const RETIRED_SYSTEM_GRANTS: readonly (readonly [string, Permission, Scope])[] = [
	['employee', 'report.weekly', 'own']
];

export type SystemRole = { key: string; name: string; description: string; locked?: boolean; grants: Grant[] };

const ROLES: SystemRole[] = [
	{
		key: 'owner',
		name: 'Owner',
		description: 'Full control of the organisation, including roles and payroll.',
		locked: true,
		grants: at('all', ...PERMISSIONS)
	},
	{
		key: 'hr_admin',
		name: 'HR Admin',
		description: 'Runs HR operations and user access across the organisation.',
		grants: at(
			'all',
			'employee.read',
			'employee.create',
			'employee.update',
			'employee.delete',
			'employee.sensitive.read',
			'employee.sensitive.update',
			'document.read',
			'document.manage',
			'org.manage',
			'settings.manage',
			'attendance.read',
			'attendance.manage',
			'attendance.approve',
			'schedule.read',
			'schedule.manage',
			'schedule.approve',
			'leave.read',
			'leave.approve',
			'leave.manage',
			'recruitment.read',
			'recruitment.manage',
			'interview.feedback',
			'performance.read',
			'performance.review',
			'performance.manage',
			'asset.read',
			'helpdesk.manage',
			'helpdesk.confidential',
			'announcement.manage',
			'event.manage',
			'survey.manage',
			'kudos.moderate',
			'skill.manage',
			'skill.validate',
			'course.manage',
			'course.report',
			'signature.manage',
			'policy.manage',
			'kb.manage',
			'letter.issue',
			'report.headcount',
			'report.attendance',
			'report.leave',
			'report.recruitment',
			'report.expense',
			'report.utilisation',
			'report.weekly',
			'travel.manage',
			'travel.read',
			'form.manage',
			'form.read',
			'workplan.edit',
			'user.manage',
			'audit.read'
		)
	},
	{
		key: 'hr_officer',
		name: 'HR Officer',
		description: 'Day-to-day HR work: records, attendance, leave and letters.',
		grants: at(
			'all',
			'employee.read',
			'employee.create',
			'employee.update',
			'document.read',
			'document.manage',
			'attendance.read',
			'attendance.manage',
			'attendance.approve',
			'schedule.read',
			'schedule.manage',
			'schedule.approve',
			'leave.read',
			'leave.approve',
			'leave.manage',
			'recruitment.read',
			'interview.feedback',
			'helpdesk.manage',
			'announcement.manage',
			'event.manage',
			'letter.issue',
			'report.headcount',
			'report.attendance',
			'report.leave'
		)
	},
	{
		key: 'payroll_officer',
		name: 'Payroll Officer',
		description: 'Prepares payroll runs and salary changes (maker).',
		grants: at(
			'all',
			'employee.read',
			'attendance.read',
			'leave.read',
			'payroll.read',
			'payroll.run',
			'salary.read',
			'salary.update',
			'comp.manage',
			'report.payroll'
		)
	},
	{
		key: 'finance',
		name: 'Finance',
		description: 'Approves payroll, salary changes, loans and pays expenses (checker).',
		grants: at(
			'all',
			'employee.read',
			'payroll.read',
			'payroll.approve',
			'salary.read',
			'salary.approve',
			'loan.approve',
			'expense.approve',
			'expense.pay',
			'travel.read',
			'report.payroll',
			'report.meal',
			'report.expense'
		)
	},
	{
		key: 'department_head',
		name: 'Department Head',
		description: 'Approves and reviews people in their department.',
		grants: [
			...at(
				'department',
				'employee.read',
				'document.read',
				'attendance.read',
				'attendance.approve',
				'schedule.read',
				'schedule.manage',
				'schedule.approve',
				'leave.read',
				'leave.approve',
				'performance.read',
				'performance.review',
				'skill.validate',
				'course.report',
				'comp.propose',
				'timesheet.approve',
				'expense.approve',
				'travel.approve',
				'form.read',
				'report.attendance',
				'report.leave',
				'report.expense',
				'report.utilisation',
				'report.weekly',
				'workplan.edit'
			),
			...at('all', 'project.read')
		]
	},
	{
		key: 'line_manager',
		name: 'Line Manager',
		description: 'Approves and reviews their direct and indirect reports.',
		grants: at(
			'team',
			'employee.read',
			'attendance.read',
			'attendance.approve',
			'schedule.read',
			'schedule.manage',
			'schedule.approve',
			'leave.read',
			'leave.approve',
			'performance.read',
			'performance.review',
			'skill.validate',
			'course.report',
			'comp.propose',
			'timesheet.approve',
			'expense.approve',
			'travel.approve',
			'form.read',
			'report.weekly',
			'workplan.edit'
		)
	},
	{
		key: 'recruiter',
		name: 'Recruiter',
		description: 'Runs hiring pipelines.',
		grants: at('all', 'recruitment.read', 'recruitment.manage', 'interview.feedback', 'report.recruitment')
	},
	{
		key: 'meal_manager',
		name: 'Meal Manager',
		description: 'Manages meal vendors, daily meals and meal bills.',
		grants: at('all', 'employee.read', 'meal.manage', 'meal.billing', 'report.meal')
	},
	{
		key: 'it_asset_manager',
		name: 'IT/Asset Manager',
		description: 'Tracks company assets and IT tickets.',
		grants: at('all', 'employee.read', 'asset.read', 'asset.manage', 'helpdesk.manage')
	},
	{
		key: 'employee',
		name: 'Employee',
		description: 'Self-service for every member: own profile, attendance, leave, payslips and requests.',
		grants: at(
			'own',
			'employee.read',
			'document.read',
			'attendance.read',
			'attendance.punch',
			'schedule.read',
			'schedule.swap',
			'leave.read',
			'leave.request',
			'loan.request',
			'meal.order',
			'performance.read',
			'project.read',
			'timesheet.submit',
			'expense.submit',
			'travel.request',
			'asset.read',
			'helpdesk.submit',
			'workplan.edit',
			'ai.use'
		)
	}
];

export const EVERY_MEMBER_GRANTS: Grant[] = at('all', 'directory.read', 'calendar.read');

export const SYSTEM_ROLES: SystemRole[] = ROLES.map((r) =>
	r.key === 'owner' ? r : { ...r, grants: [...r.grants, ...EVERY_MEMBER_GRANTS] }
);
