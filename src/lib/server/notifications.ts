import { and, eq, inArray, sql } from 'drizzle-orm';
import { config } from './config';
import { notificationPrefs, notifications } from './db/schema';
import { sendMail, type Mail } from './mail';
import type { Tx } from './tenancy';

export const NOTIFICATION_CATEGORIES = {
	access: 'Access and roles',
	approvals: 'Approvals',
	profile: 'Profile changes',
	people: 'Joiners and leavers',
	recruitment: 'Interviews',
	performance: 'Performance reviews',
	helpdesk: 'Helpdesk tickets',
	policies: 'Policies to read',
	letters: 'Letters issued to you',
	reports: 'Reports shared with you',
	celebrations: 'Birthdays and work anniversaries in your team',
	events: 'Reminders for events you said you will attend',
	schedule: 'Published schedules',
	kiosk: 'Attendance kiosk lockouts',
	webhooks: 'Webhook endpoints turned off after failures',
	surveys: 'Surveys to answer',
	kudos: 'Kudos you receive',
	mentions: 'Mentions in announcement comments',
	one_on_ones: '1:1 meetings scheduled with you',
	feedback: 'Feedback and feedback requests',
	jobs: 'Internal job applications from your team',
	learning: 'Courses assigned to you and reminders before they are due',
	signatures: 'Documents waiting for your signature and signed or declined requests',
	forms: 'Forms to fill and their reminders',
	tasks: 'Tasks assigned to you'
} as const;

export type NotificationCategory = keyof typeof NOTIFICATION_CATEGORIES;

export type NewNotification = { category: NotificationCategory; title: string; body?: string; link?: string };

export async function notify(
	tx: Tx,
	tenantId: string,
	membershipIds: string[],
	n: NewNotification,
	tenantSlug: string,
	opts: { ignoreOptOut?: boolean } = {}
): Promise<Mail[]> {
	const ids = [...new Set(membershipIds)];
	if (!ids.length) return [];
	await tx.insert(notifications).values(ids.map((membershipId) => ({ tenantId, membershipId, ...n })));
	const optedOut = opts.ignoreOptOut
		? []
		: await tx
				.select({ id: notificationPrefs.membershipId })
				.from(notificationPrefs)
				.where(
					and(
						inArray(notificationPrefs.membershipId, ids),
						eq(notificationPrefs.category, n.category),
						eq(notificationPrefs.email, false)
					)
				);
	const skip = new Set(optedOut.map((r) => r.id));
	const recipients = ids.filter((id) => !skip.has(id));
	if (!recipients.length) return [];
	const rows = await tx.execute<{ email: string }>(
		sql`select email from tenant_users where membership_id in ${recipients} and membership_status = 'active'`
	);
	const link = n.link ? `\n\n${config().APP_URL}/t/${tenantSlug}/${n.link}` : '';
	return rows.map((r) => ({ to: r.email, subject: n.title, text: `${n.body ?? n.title}${link}` }));
}

export const sendAll = async (mails: Mail[]): Promise<void> => {
	await Promise.all(mails.map((m) => sendMail(m)));
};
