import { and, asc, desc, eq, gt, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { activeMemberships } from './approval-chain';
import { now } from './clock';
import { employees, tasks } from './db/schema';
import { AppError } from './errors';
import { tenantToday } from './lifecycle';
import { notify } from './notifications';
import { userCtx, type requireMember } from './rbac/access';
import { inScope, resolveScope, scopeWhere } from './rbac/scope';
import { withTenant, type Tx } from './tenancy';

type Member = ReturnType<typeof requireMember>;

export const TASKS = { rows: 100, people: 500 };

const taskSchema = z.object({
	title: z
		.string()
		.trim()
		.min(1, 'Give the task a title.')
		.max(200, 'Keep the title under 200 characters.')
		.refine((v) => !/\p{Cc}/u.test(v), 'Remove control characters.'),
	description: z
		.string()
		.trim()
		.max(2000, 'Keep the description under 2000 characters.')
		.refine((v) => !v.includes('\0'), 'Remove unsupported characters.')
		.prefault(''),
	assigneeEmployeeId: z.uuid({ error: 'Choose who does the task.' }),
	dueOn: z
		.union([
			z.literal(''),
			z.iso
				.date('Enter the due date.')
				.refine((d) => d >= '2000-01-01' && d <= '2099-12-31', 'Choose a date between 2000 and 2099.')
		])
		.prefault('')
});

const taskId = z.object({ taskId: z.uuid({ error: 'Choose a task.' }) });
const statusSchema = taskId.extend({ done: z.enum(['true', 'false'], 'Choose done or open.') });

const notFound = () => new AppError('not_found', 'That task does not exist.', 404);

export async function createTask(m: Member, form: Record<string, string>) {
	const input = taskSchema.parse(form);
	return withTenant(userCtx(m), async (tx) => {
		const self = input.assigneeEmployeeId === m.access.employeeId;
		if (!self && !inScope(await resolveScope(tx, m.access, 'employee.read'), input.assigneeEmployeeId))
			throw new AppError('bad_assignee', 'Choose someone you can assign tasks to.', 400);
		const [e] = await tx
			.select({ status: employees.status })
			.from(employees)
			.where(eq(employees.id, input.assigneeEmployeeId));
		if (!e || e.status === 'exited') throw new AppError('bad_assignee', 'Choose someone you can assign tasks to.', 400);
		if (input.dueOn && input.dueOn < (await tenantToday(tx)))
			throw new AppError('past_due', 'The due date cannot be in the past.', 400);
		await tx.insert(tasks).values({
			tenantId: m.tenant.id,
			title: input.title,
			description: input.description || null,
			assigneeEmployeeId: input.assigneeEmployeeId,
			dueOn: input.dueOn || null,
			createdByUserId: m.user.userId
		});
		if (self) return [];
		return notify(
			tx,
			m.tenant.id,
			await activeMemberships(tx, input.assigneeEmployeeId),
			{
				category: 'tasks',
				title: `New task: ${input.title}`,
				body: input.dueOn ? `Due ${input.dueOn}.` : undefined,
				link: 'tasks'
			},
			m.tenant.slug
		);
	});
}

async function ownTask(tx: Tx, m: Member, id: string) {
	const [t] = await tx.select().from(tasks).where(eq(tasks.id, id)).for('update');
	if (!t) throw notFound();
	const assignee = t.assigneeEmployeeId === m.access.employeeId;
	const creator = t.createdByUserId === m.user.userId;
	if (!assignee && !creator) throw notFound();
	return { t, creator };
}

export async function setTaskStatus(m: Member, form: Record<string, string>) {
	const input = statusSchema.parse(form);
	await withTenant(userCtx(m), async (tx) => {
		const { t } = await ownTask(tx, m, input.taskId);
		const done = input.done === 'true';
		await tx
			.update(tasks)
			.set({ status: done ? 'done' : 'open', doneAt: done ? now() : null })
			.where(eq(tasks.id, t.id));
	});
}

export async function deleteTask(m: Member, form: Record<string, string>) {
	const input = taskId.parse(form);
	await withTenant(userCtx(m), async (tx) => {
		const { t, creator } = await ownTask(tx, m, input.taskId);
		if (!creator) throw new AppError('forbidden', 'Only the person who made the task can delete it.', 403);
		await tx.delete(tasks).where(eq(tasks.id, t.id));
	});
}

const taskFields = {
	id: tasks.id,
	title: tasks.title,
	description: tasks.description,
	dueOn: tasks.dueOn,
	status: tasks.status,
	assigneeEmployeeId: tasks.assigneeEmployeeId,
	createdByUserId: tasks.createdByUserId,
	createdAt: tasks.createdAt,
	assignee: employees.fullName
};

export async function taskBoard(tx: Tx, m: Member) {
	const me = m.access.employeeId;
	const base = () => tx.select(taskFields).from(tasks).innerJoin(employees, eq(employees.id, tasks.assigneeEmployeeId));
	const order = [asc(tasks.status), sql`${tasks.dueOn} asc nulls last`, desc(tasks.createdAt)];
	const recent = or(eq(tasks.status, 'open'), gt(tasks.doneAt, new Date(now().getTime() - 30 * 86_400_000)));
	const mine = me
		? await base()
				.where(and(eq(tasks.assigneeEmployeeId, me), recent))
				.orderBy(...order)
				.limit(TASKS.rows)
		: [];
	const given = await base()
		.where(and(eq(tasks.createdByUserId, m.user.userId), me ? ne(tasks.assigneeEmployeeId, me) : undefined, recent))
		.orderBy(...order)
		.limit(TASKS.rows);
	const scope = await resolveScope(tx, m.access, 'employee.read');
	const people = await tx
		.select({ id: employees.id, name: employees.fullName, code: employees.code })
		.from(employees)
		.where(
			and(
				sql`${employees.status} <> 'exited'`,
				or(scopeWhere(scope, employees.id), me ? eq(employees.id, me) : undefined)
			)
		)
		.orderBy(asc(employees.fullName))
		.limit(TASKS.people);
	return { today: await tenantToday(tx), me, mine, given, people };
}
