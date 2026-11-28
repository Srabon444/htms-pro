import type { ModuleId } from './modules';
import type { Permission } from './rbac/permissions';
import { SETTING_SECTIONS } from './settings-sections';

export type SettingsPage = {
	href: string;
	label: string;
	group: string;
	perm: Permission | Permission[];
	about: string;
	module?: ModuleId;
};

export const SETTINGS_PAGES: SettingsPage[] = [
	{
		href: 'organisation',
		label: 'General',
		group: 'Organisation',
		perm: 'settings.manage',
		about: 'Name, address, time zone, fiscal year and weekend days.'
	},
	{
		href: 'modules',
		label: 'Modules',
		group: 'Organisation',
		perm: 'settings.manage',
		about: 'Turn the directory, birthdays and other optional parts on or off.'
	},
	{
		href: 'people',
		label: 'People',
		group: 'Organisation',
		perm: 'settings.manage',
		about: SETTING_SECTIONS.people.intro
	},
	{
		href: 'users',
		label: 'Users',
		group: 'Access',
		perm: 'user.manage',
		about: 'Invite people, set their roles, disable access.'
	},
	{
		href: 'roles',
		label: 'Roles',
		group: 'Access',
		perm: 'role.manage',
		about: 'What each role can see and do, and for whom.'
	},
	{
		href: 'security',
		label: 'Security and retention',
		group: 'Access',
		perm: 'settings.manage',
		about: SETTING_SECTIONS.security.intro
	},
	{
		href: 'ai',
		label: 'AI',
		group: 'Access',
		perm: 'ai.manage',
		about: 'AI provider, API key, model, monthly budget and which AI features are on.'
	},
	{ href: 'audit', label: 'Audit log', group: 'Access', perm: 'audit.read', about: 'Who changed what, and when.' },
	{
		href: 'api-keys',
		label: 'API keys',
		group: 'Access',
		perm: 'api.manage',
		about: 'Keys that let other systems read employees, leave, attendance, rosters and events.'
	},
	{
		href: 'webhooks',
		label: 'Webhooks',
		group: 'Access',
		perm: 'api.manage',
		about: 'Tell other systems when employees or leave requests change.'
	},
	{
		href: 'sso',
		label: 'Company sign-in',
		group: 'Access',
		perm: 'sso.manage',
		about: 'Sign in with Google Workspace or Microsoft Entra, verified email domains, and whether it is required.'
	},
	{
		href: 'data-export',
		label: 'Data export',
		group: 'Access',
		perm: 'data.export',
		about: 'Download employees, leave, attendance, assets, tickets, expenses and pay as CSV.'
	},
	{
		href: 'attendance',
		label: 'Attendance rules',
		group: 'Time',
		perm: 'settings.manage',
		about: SETTING_SECTIONS.attendance.intro
	},
	{
		href: 'shifts',
		label: 'Shifts',
		group: 'Time',
		perm: 'attendance.manage',
		about: 'Working hours, late grace and day lengths.'
	},
	{
		href: 'work-sites',
		label: 'Work sites',
		group: 'Time',
		perm: 'attendance.manage',
		about: 'Office locations and networks punches are checked against.'
	},
	{
		href: 'attendance-devices',
		label: 'Attendance devices',
		group: 'Time',
		perm: 'attendance.manage',
		about: 'Fingerprint and card readers that send punches, and punches to check after payroll.'
	},
	{
		href: 'kiosks',
		label: 'Kiosks',
		group: 'Time',
		perm: 'attendance.manage',
		module: 'kiosk',
		about: 'Shared tablets where staff punch in with their code and a PIN.'
	},
	{
		href: 'work-weeks',
		label: 'Work weeks',
		group: 'Time',
		perm: 'attendance.manage',
		about: 'Different weekend days for some people.'
	},
	{
		href: 'leave-types',
		label: 'Leave types',
		group: 'Time',
		perm: 'leave.manage',
		about: 'Quotas, accrual, carry-over and notice rules.'
	},
	{
		href: 'payroll',
		label: 'Payroll settings',
		group: 'Money',
		perm: 'settings.manage',
		about: 'Part months, provident fund, overtime, bonus and gratuity.'
	},
	{
		href: 'tax',
		label: 'Income tax',
		group: 'Money',
		perm: ['settings.manage', 'payroll.run'],
		about: 'Tax years, rules, rebates and employee tax profiles.'
	},
	{ href: 'loans', label: 'Loan rules', group: 'Money', perm: 'settings.manage', about: SETTING_SECTIONS.loans.intro },
	{
		href: 'meals',
		label: 'Meal setup',
		group: 'Money',
		perm: 'meal.manage',
		about: 'Vendors, meal types, prices and ordering rules.'
	},
	{
		href: 'checklists',
		label: 'Checklists',
		group: 'Workflows',
		perm: 'settings.manage',
		about: 'Onboarding and exit task lists.'
	},
	{
		href: 'helpdesk',
		label: 'Helpdesk setup',
		group: 'Workflows',
		perm: 'helpdesk.manage',
		about: 'Ticket categories, response times and confidentiality.'
	},
	{
		href: 'letters',
		label: 'Letter templates',
		group: 'Workflows',
		perm: 'letter.issue',
		about: 'Wording of offer, appointment and other letters.'
	},
	{
		href: 'reports',
		label: 'Report sharing',
		group: 'Workflows',
		perm: 'settings.manage',
		about: SETTING_SECTIONS.reports.intro
	}
];

export const allowedSettingsPages = (allowed: (perm: Permission) => boolean, modules: Set<ModuleId>): SettingsPage[] =>
	SETTINGS_PAGES.filter((p) => (!p.module || modules.has(p.module)) && [p.perm].flat().some(allowed));

export type NavItem = {
	href: string;
	label: string;
	group: string;
	perm?: Permission | Permission[];
	self?: true;
	active?: true;
	module?: ModuleId;
	ai?: 'ask';
};

const REPORT_PERMS: Permission[] = [
	'report.headcount',
	'report.attendance',
	'report.leave',
	'report.payroll',
	'report.meal',
	'report.expense',
	'report.recruitment',
	'report.utilisation',
	'report.weekly'
];

export const NAV: NavItem[] = [
	{ href: '', label: 'Home', group: 'Workspace' },
	{ href: 'notifications', label: 'Notifications', group: 'Workspace' },
	{ href: 'approvals', label: 'Approvals', group: 'Workspace' },
	{ href: 'calendar', label: 'Calendar', group: 'Workspace', perm: 'calendar.read', module: 'calendar' },
	{ href: 'tasks', label: 'Tasks', group: 'Workspace' },
	{ href: 'assistant', label: 'Ask HR', group: 'Workspace', perm: 'ai.use', ai: 'ask' },
	{ href: 'letters', label: 'Letters', group: 'Workspace' },
	{
		href: 'helpdesk',
		label: 'Helpdesk',
		group: 'Workspace',
		perm: ['helpdesk.submit', 'helpdesk.manage', 'helpdesk.confidential']
	},
	{ href: 'announcements', label: 'Announcements', group: 'Communicate', active: true },
	{ href: 'events', label: 'Events', group: 'Communicate', perm: 'calendar.read', module: 'events' },
	{ href: 'directory', label: 'Directory', group: 'Communicate', perm: 'directory.read', module: 'directory' },
	{ href: 'surveys', label: 'Surveys', group: 'Communicate', module: 'surveys' },
	{ href: 'kudos', label: 'Kudos', group: 'Communicate', module: 'kudos' },
	{ href: 'leave', label: 'Leave', group: 'My work', perm: 'leave.request' },
	{ href: 'schedule', label: 'Schedule', group: 'My work', perm: 'schedule.read', module: 'schedule' },
	{ href: 'attendance', label: 'Attendance', group: 'My work', perm: 'attendance.read' },
	{ href: 'meals', label: 'Meals', group: 'My work', perm: 'meal.order' },
	{ href: 'timesheets', label: 'Timesheets', group: 'My work', perm: ['timesheet.submit', 'timesheet.approve'] },
	{ href: 'work-plan', label: 'Work plan', group: 'My work', perm: 'workplan.edit' },
	{ href: 'payslips', label: 'My payslips', group: 'My work', self: true },
	{
		href: 'expenses',
		label: 'Expenses',
		group: 'My work',
		perm: ['expense.submit', 'expense.approve', 'expense.pay']
	},
	{ href: 'loans', label: 'Loans', group: 'My work', perm: ['loan.request', 'loan.approve'] },
	{
		href: 'travel',
		label: 'Travel',
		group: 'My work',
		perm: ['travel.request', 'travel.approve', 'travel.manage', 'travel.read'],
		module: 'travel'
	},
	{ href: 'signatures', label: 'Signatures', group: 'My work', module: 'esign' },
	{ href: 'forms', label: 'Forms', group: 'My work', module: 'forms' },
	{ href: 'policies', label: 'Policies', group: 'Learn', active: true },
	{ href: 'learning', label: 'Learning', group: 'Learn', module: 'learning' },
	{ href: 'employees', label: 'Employees', group: 'People', perm: 'employee.read' },
	{ href: 'lifecycle', label: 'Lifecycle', group: 'People', perm: 'employee.update' },
	{ href: 'recruitment', label: 'Recruitment', group: 'People', perm: 'recruitment.read' },
	{ href: 'recruitment/interviews', label: 'My interviews', group: 'People', perm: 'interview.feedback' },
	{ href: 'performance', label: 'Performance', group: 'People', perm: 'performance.read' },
	{ href: 'one-on-ones', label: '1:1s', group: 'People', perm: 'performance.read', module: 'one_on_ones' },
	{ href: 'feedback', label: 'Feedback', group: 'People', module: 'one_on_ones' },
	{ href: 'skills', label: 'Skills', group: 'People', module: 'talent' },
	{ href: 'jobs', label: 'Internal jobs', group: 'People', module: 'talent' },
	{ href: 'projects', label: 'Projects', group: 'People', perm: 'project.read' },
	{ href: 'assets', label: 'Assets', group: 'People', perm: 'asset.read' },
	{ href: 'payroll', label: 'Payroll', group: 'Finance', perm: ['payroll.run', 'payroll.approve'] },
	{ href: 'payroll/salaries', label: 'Salaries', group: 'Finance', perm: 'salary.read' },
	{ href: 'payroll/reviews', label: 'Pay reviews', group: 'Finance', perm: ['comp.propose', 'comp.manage'] },
	{ href: 'meals/bills', label: 'Meal bills', group: 'Finance', perm: 'meal.billing' },
	{ href: 'reports', label: 'Reports', group: 'Admin', perm: REPORT_PERMS },
	{ href: 'org', label: 'Organisation', group: 'Admin', perm: 'org.manage' },
	{
		href: 'settings',
		label: 'Settings',
		group: 'Admin',
		perm: [...new Set(SETTINGS_PAGES.flatMap((p) => [p.perm].flat()))]
	}
];
