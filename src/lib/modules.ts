export type ModuleInfo = { label: string; about: string; on: boolean; routes: readonly string[] };

export const MODULES = {
	directory: {
		label: 'Directory and org chart',
		about: 'Colleague list, org chart and work anniversaries for everyone in the organisation.',
		on: true,
		routes: ['directory']
	},
	calendar: {
		label: 'Team calendar',
		about: 'Month view of who is out, holidays and events, plus a private feed for Google, Outlook or Apple calendars.',
		on: true,
		routes: ['calendar']
	},
	events: {
		label: 'Events',
		about: 'Company and team events with RSVP and a reminder the day before.',
		on: true,
		routes: ['events']
	},
	schedule: {
		label: 'Schedule',
		about: 'Weekly roster with draft and publish, availability and copying a week, on top of shifts and work weeks.',
		on: true,
		routes: ['schedule']
	},
	surveys: {
		label: 'Surveys and suggestion box',
		about: 'Pulse and eNPS surveys, anonymous by default, and an always-open anonymous suggestion box.',
		on: true,
		routes: ['surveys']
	},
	kudos: {
		label: 'Kudos',
		about: 'A recognition wall where colleagues thank each other, tagged with the company values.',
		on: true,
		routes: ['kudos']
	},
	one_on_ones: {
		label: '1:1s and feedback',
		about: 'Manager and employee 1:1s with shared agenda and actions, private notes, and continuous feedback.',
		on: false,
		routes: ['one-on-ones', 'feedback']
	},
	talent: {
		label: 'Skills and internal jobs',
		about: 'A skills catalogue with manager validation, an internal job board with skill match, and referral bonuses.',
		on: false,
		routes: ['skills', 'jobs']
	},
	knowledge: {
		label: 'Knowledge base',
		about:
			'Articles in folders, each folder open to everyone, a department or a branch, listed with the company policies.',
		on: true,
		routes: ['knowledge']
	},
	learning: {
		label: 'Learning',
		about:
			'Courses with lessons and quizzes, assignments with due dates and renewals, certificates and external certifications.',
		on: false,
		routes: ['learning']
	},
	esign: {
		label: 'E-signature',
		about:
			'Send a PDF for signature in order to staff and outside people, with email codes, a document hash and a certificate of completion.',
		on: false,
		routes: ['signatures']
	},
	travel: {
		label: 'Travel and per diem',
		about:
			'Trip requests with manager approval, an optional travel advance, per diem rates by country or city, and expense claims settled against the advance.',
		on: false,
		routes: ['travel']
	},
	forms: {
		label: 'Forms and checklists',
		about:
			'Forms and read-and-sign checklists assigned once, daily or weekly, with photo and file answers, reminders and a submissions list.',
		on: false,
		routes: ['forms']
	},
	careers: {
		label: 'Careers page',
		about: 'A public page listing open jobs where anyone can apply with their CV, with spam and rate limits.',
		on: false,
		routes: []
	},
	kiosk: {
		label: 'Attendance kiosk',
		about: 'A shared tablet at a work site where staff punch in with their employee code and a PIN.',
		on: false,
		routes: ['settings/kiosks']
	},
	celebrations_birthdays: {
		label: 'Birthdays',
		about: 'People can choose to show their birthday (day and month only) in the directory and on the home page.',
		on: false,
		routes: []
	}
} as const satisfies Record<string, ModuleInfo>;

export type ModuleId = keyof typeof MODULES;

export const MODULE_IDS = Object.keys(MODULES) as ModuleId[];

export type ModuleOverrides = { modulesEnabled: string[]; modulesDisabled: string[] };

export const moduleOn = (s: ModuleOverrides, m: ModuleId): boolean =>
	MODULES[m].on ? !s.modulesDisabled.includes(m) : s.modulesEnabled.includes(m);

export const overridesFor = (on: ModuleId[]): ModuleOverrides => ({
	modulesEnabled: MODULE_IDS.filter((id) => !MODULES[id].on && on.includes(id)),
	modulesDisabled: MODULE_IDS.filter((id) => MODULES[id].on && !on.includes(id))
});
