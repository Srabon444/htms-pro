import { desc, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import {
	attendanceRequests,
	branches,
	departments,
	designations,
	employees,
	expenseClaims,
	formSubmissions,
	forms,
	leaveRequests,
	leaveTypes,
	loans,
	tenantSettings,
	tickets,
	travelRequests
} from './db/schema';
import type { Permission } from '../rbac/permissions';
import { dateIn, zoneFormat } from './dates';
import { modulesOn } from './modules';
import { can, type requireMember } from './rbac/access';
import type { Tx } from './tenancy';

type Member = ReturnType<typeof requireMember>;

export const ME = { perModule: 20, activity: 50 };
export const ME_TABS = ['details', 'payslips', 'requests', 'activity'] as const;

export const ACTIVITY_TABLES: Record<string, string> = {
	leave_requests: 'Leave request',
	attendance_requests: 'Attendance request',
	expense_claims: 'Expense claim',
	loans: 'Loan or advance',
	travel_requests: 'Trip',
	tickets: 'Help desk ticket',
	ticket_comments: 'Help desk reply',
	form_submissions: 'Form',
	tasks: 'Task',
	change_requests: 'Profile change request',
	kudos: 'Kudos',
	announcement_comments: 'Announcement comment',
	files: 'File',
	policies: 'Policy',
	policy_acknowledgements: 'Policy acknowledgement',
	letters: 'Letter',
	employee_documents: 'Document',
	signature_signers: 'Signature',
	employees: 'Employee record'
};

export async function myDetails(tx: Tx, m: Member) {
	const me = m.access.employeeId;
	if (!me) return null;
	const manager = alias(employees, 'me_manager');
	const [row] = await tx
		.select({
			id: employees.id,
			code: employees.code,
			fullName: employees.fullName,
			workEmail: employees.workEmail,
			phone: employees.phone,
			department: departments.name,
			designation: designations.name,
			branch: branches.name,
			manager: manager.fullName,
			joinDate: employees.joinDate,
			status: employees.status
		})
		.from(employees)
		.leftJoin(departments, eq(departments.id, employees.departmentId))
		.leftJoin(designations, eq(designations.id, employees.designationId))
		.leftJoin(branches, eq(branches.id, employees.branchId))
		.leftJoin(manager, eq(manager.id, employees.managerId))
		.where(eq(employees.id, me));
	return row ? { ...row, canOpen: can(m.access, 'employee.read') } : null;
}

type Item = { id: string; label: string; status: string; at: Date; link: string };

const zoneOf = async (tx: Tx) =>
	(await tx.select({ tz: tenantSettings.timezone }).from(tenantSettings))[0]?.tz ?? 'UTC';

export async function myRequests(tx: Tx, m: Member) {
	const me = m.access.employeeId;
	if (!me) return [];
	const on = await modulesOn(tx);
	const n = ME.perModule;
	const groups: { key: string; title: string; link: string; perms: Permission[]; items: () => Promise<Item[]> }[] = [
		{
			key: 'leave',
			perms: ['leave.request', 'leave.read'],
			title: 'Leave',
			link: 'leave',
			items: () =>
				tx
					.select({
						id: leaveRequests.id,
						type: leaveTypes.name,
						start: leaveRequests.startDate,
						end: leaveRequests.endDate,
						status: leaveRequests.status,
						at: leaveRequests.createdAt
					})
					.from(leaveRequests)
					.innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
					.where(eq(leaveRequests.employeeId, me))
					.orderBy(desc(leaveRequests.createdAt))
					.limit(n)
					.then((rows) =>
						rows.map((r) => ({
							id: r.id,
							label: r.start === r.end ? `${r.type} on ${r.start}` : `${r.type}, ${r.start} to ${r.end}`,
							status: r.status,
							at: r.at,
							link: 'leave'
						}))
					)
		},
		{
			key: 'attendance',
			perms: ['attendance.read'],
			title: 'Attendance requests',
			link: 'attendance',
			items: () =>
				tx
					.select({
						id: attendanceRequests.id,
						kind: attendanceRequests.kind,
						date: attendanceRequests.date,
						status: attendanceRequests.status,
						at: attendanceRequests.createdAt
					})
					.from(attendanceRequests)
					.where(eq(attendanceRequests.employeeId, me))
					.orderBy(desc(attendanceRequests.createdAt))
					.limit(n)
					.then((rows) =>
						rows.map((r) => ({
							id: r.id,
							label: `${KIND[r.kind] ?? r.kind} on ${r.date}`,
							status: r.status,
							at: r.at,
							link: 'attendance'
						}))
					)
		},
		{
			key: 'expenses',
			perms: ['expense.submit', 'expense.approve', 'expense.pay'],
			title: 'Expense claims',
			link: 'expenses',
			items: () =>
				tx
					.select({
						id: expenseClaims.id,
						label: expenseClaims.title,
						status: expenseClaims.status,
						at: expenseClaims.createdAt
					})
					.from(expenseClaims)
					.where(eq(expenseClaims.employeeId, me))
					.orderBy(desc(expenseClaims.createdAt))
					.limit(n)
					.then((rows) => rows.map((r) => ({ ...r, link: 'expenses' })))
		},
		{
			key: 'loans',
			perms: ['loan.request', 'loan.approve'],
			title: 'Loans and advances',
			link: 'loans',
			items: () =>
				tx
					.select({ id: loans.id, kind: loans.kind, reason: loans.reason, status: loans.status, at: loans.createdAt })
					.from(loans)
					.where(eq(loans.employeeId, me))
					.orderBy(desc(loans.createdAt))
					.limit(n)
					.then((rows) =>
						rows.map((r) => ({
							id: r.id,
							label: `${r.kind === 'advance' ? 'Salary advance' : 'Loan'}: ${r.reason}`,
							status: r.status,
							at: r.at,
							link: 'loans'
						}))
					)
		},
		{
			key: 'helpdesk',
			perms: ['helpdesk.submit', 'helpdesk.manage', 'helpdesk.confidential'],
			title: 'Help desk tickets',
			link: 'helpdesk',
			items: () =>
				tx
					.select({ id: tickets.id, label: tickets.subject, status: tickets.status, at: tickets.createdAt })
					.from(tickets)
					.where(eq(tickets.requesterEmployeeId, me))
					.orderBy(desc(tickets.createdAt))
					.limit(n)
					.then((rows) => rows.map((r) => ({ ...r, link: `helpdesk/${r.id}` })))
		}
	];
	if (on.has('travel'))
		groups.push({
			key: 'travel',
			perms: ['travel.request', 'travel.approve', 'travel.manage', 'travel.read'],
			title: 'Trips',
			link: 'travel',
			items: () =>
				tx
					.select({
						id: travelRequests.id,
						label: travelRequests.purpose,
						status: travelRequests.status,
						at: travelRequests.createdAt
					})
					.from(travelRequests)
					.where(eq(travelRequests.employeeId, me))
					.orderBy(desc(travelRequests.createdAt))
					.limit(n)
					.then((rows) => rows.map((r) => ({ ...r, link: 'travel' })))
		});
	if (on.has('forms'))
		groups.push({
			key: 'forms',
			perms: [],
			title: 'Form submissions',
			link: 'forms',
			items: () =>
				tx
					.select({
						id: formSubmissions.id,
						title: forms.title,
						period: formSubmissions.period,
						at: formSubmissions.createdAt
					})
					.from(formSubmissions)
					.innerJoin(forms, eq(forms.id, formSubmissions.formId))
					.where(eq(formSubmissions.employeeId, me))
					.orderBy(desc(formSubmissions.createdAt))
					.limit(n)
					.then((rows) =>
						rows.map((r) => ({
							id: r.id,
							label: `${r.title} · ${r.period}`,
							status: 'sent',
							at: r.at,
							link: 'forms'
						}))
					)
		});
	const tz = await zoneOf(tx);
	const shown = [];
	for (const g of groups.filter((x) => !x.perms.length || x.perms.some((p) => can(m.access, p))))
		shown.push({
			key: g.key,
			title: g.title,
			link: g.link,
			items: (await g.items()).map(({ at, ...i }) => ({ ...i, on: dateIn(at, tz) }))
		});
	return shown;
}

const KIND: Record<string, string> = { regularization: 'Attendance fix', wfh: 'Work from home', overtime: 'Overtime' };

const beforeSchema = z.uuid().optional().catch(undefined);

type ActivityRow = { id: string; created_at: string | Date; table_name: string; op: string; event: string | null };

export async function myActivity(tx: Tx, m: Member, rawBefore?: string | null) {
	const cursor = beforeSchema.parse(rawBefore ?? undefined);
	const known = cursor
		? await tx.execute<{ id: string }>(
				sql`select id from audit_log where id = ${cursor}::uuid and actor_user_id = ${m.user.userId}::uuid`
			)
		: [];
	const before = known[0]?.id ?? null;
	const tz = await zoneOf(tx);
	const clock = zoneFormat(tz, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
	const tables = Object.keys(ACTIVITY_TABLES);
	const rows = await tx.execute<ActivityRow>(sql`
		select a.id, a.created_at, a.table_name, a.op, a.event
		from audit_log a
		where a.actor_user_id = ${m.user.userId}::uuid
			and a.table_name in ${sql`(${sql.join(
				tables.map((t) => sql`${t}`),
				sql`, `
			)})`}
			and (${before}::uuid is null or (a.created_at, a.id) < (
				select b.created_at, b.id from audit_log b where b.id = ${before}::uuid and b.actor_user_id = ${m.user.userId}::uuid))
		order by a.created_at desc, a.id desc
		limit ${ME.activity + 1}`);
	const page = rows.slice(0, ME.activity);
	return {
		next: rows.length > ME.activity ? page[page.length - 1].id : null,
		entries: page.map((r) => ({
			id: r.id,
			at: `${dateIn(new Date(r.created_at), tz)} ${clock.format(new Date(r.created_at))}`,
			what: ACTIVITY_TABLES[r.table_name],
			action: (r.event && EVENT[r.event]) ?? OP[r.op] ?? r.op
		}))
	};
}

const OP: Record<string, string> = { INSERT: 'Created', UPDATE: 'Changed', DELETE: 'Deleted', READ: 'Opened' };
const EVENT: Record<string, string> = {
	'file.download': 'Downloaded',
	'policy.download': 'Downloaded',
	'letter.download': 'Downloaded',
	'document.download': 'Downloaded',
	'employee.export': 'Exported',
	signed: 'Signed',
	declined: 'Declined',
	invite_resent: 'Sent a reminder'
};

export const tabOf = (raw: string | null) =>
	(ME_TABS as readonly string[]).includes(raw ?? '') ? (raw as (typeof ME_TABS)[number]) : 'details';
