import { and, asc, count, eq } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { announcementAttachments } from './announcements';
import { assetAttachments } from './assets';
import { attendanceAttachments } from './attendance-requests';
import { changeAttachments } from './change-requests';
import { checklistItemAttachments } from './checklists';
import { auditEvent } from './audit';
import { discardFiles } from './file-store';
import { formSubmissionAttachments } from './forms';
import { ticketAttachments, ticketCommentAttachments } from './helpdesk';
import { certificationAttachments, lessonAttachments } from './learning';
import { leaveAttachments } from './leave-requests';
import { loanAttachments } from './loans';
import { mealBillAttachments } from './meal-bills';
import { goalAttachments, reviewAttachments } from './performance';
import { educationAttachments, experienceAttachments } from './profile';
import { projectAttachments } from './projects';
import { files, MAX_ATTACHMENTS, MAX_DOCUMENT_BYTES, type AttachmentOwner } from './db/schema';
import { AppError } from './errors';
import { log } from './log';
import { candidateAttachments, feedbackAttachments, offerAttachments } from './recruitment';
import { resignationAttachments } from './resignations';
import { salaryAttachments, salaryCtx } from './salaries';
import type { Access, requireMember } from './rbac/access';
import { safeFileName, sniffType } from './sniff';
import { deleteObject, getObject, putObject } from './storage';
import { withTenant, type TenantCtx, type Tx } from './tenancy';

type Member = ReturnType<typeof requireMember>;
export type AttachmentRules = {
	canRead(tx: Tx, access: Access, ownerId: string): Promise<boolean>;
	canEdit(tx: Tx, access: Access, ownerId: string, lock: boolean): Promise<boolean>;
};
type Stored = { key: string; filename: string; mime: string; size: number; sha256: string };

const owners = (): Record<AttachmentOwner, AttachmentRules> => ({
	announcement: announcementAttachments,
	asset: assetAttachments,
	attendance_request: attendanceAttachments,
	change_request: changeAttachments,
	candidate: candidateAttachments,
	certification: certificationAttachments,
	form_submission: formSubmissionAttachments,
	checklist_item: checklistItemAttachments,
	course_lesson: lessonAttachments,
	education: educationAttachments,
	experience: experienceAttachments,
	goal: goalAttachments,
	interview_feedback: feedbackAttachments,
	leave_request: leaveAttachments,
	loan: loanAttachments,
	meal_bill: mealBillAttachments,
	offer: offerAttachments,
	project: projectAttachments,
	resignation: resignationAttachments,
	review: reviewAttachments,
	salary_change: salaryAttachments,
	ticket: ticketAttachments,
	ticket_comment: ticketCommentAttachments
});
const ALLOWED = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];

const notFound = () => new AppError('not_found', 'That file does not exist.', 404);
const rules = (type: AttachmentOwner) => owners()[type];
const isId = (id: string) => z.uuid().safeParse(id).success;

async function assertEditable(tx: Tx, access: Access, type: AttachmentOwner, ownerId: string, lock: boolean) {
	if (!isId(ownerId) || !(await rules(type).canRead(tx, access, ownerId))) throw notFound();
	if (!(await rules(type).canEdit(tx, access, ownerId, lock)))
		throw new AppError('forbidden', 'You cannot change the files here.', 403);
}

async function assertRoom(tx: Tx, type: AttachmentOwner, ownerId: string, adding: number, removing = 0) {
	const [{ n }] = await tx
		.select({ n: count() })
		.from(files)
		.where(and(eq(files.ownerType, type), eq(files.ownerId, ownerId)));
	if (n - removing + adding > MAX_ATTACHMENTS)
		throw new AppError('too_many', `Attach at most ${MAX_ATTACHMENTS} files.`, 409);
}

export async function prepareFiles(tenantId: string, type: AttachmentOwner, list: File[]): Promise<Stored[]> {
	const picked = list.filter((f) => f.size > 0);
	if (!picked.length) throw new AppError('no_file', 'Choose a file to attach.', 400);
	if (picked.length > MAX_ATTACHMENTS) throw new AppError('too_many', `Attach at most ${MAX_ATTACHMENTS} files.`, 409);
	if (picked.reduce((n, f) => n + f.size, 0) > MAX_DOCUMENT_BYTES)
		throw new AppError('too_large', 'Files can be at most 10 MB in total.', 413);
	const read = await Promise.all(
		picked.map(async (f) => {
			const bytes = new Uint8Array(await f.arrayBuffer());
			const mime = sniffType(bytes, f.name);
			if (!mime || !ALLOWED.includes(mime))
				throw new AppError('unsupported_file', 'Attach a PDF or a PNG, JPEG or WEBP image.', 415);
			return { bytes, mime, filename: safeFileName(f.name) };
		})
	);
	const stored: Stored[] = [];
	try {
		for (const r of read) {
			const key = `t/${tenantId}/attachments/${type}/${randomUUID()}`;
			await putObject(key, r.bytes, r.mime);
			stored.push({
				key,
				filename: r.filename,
				mime: r.mime,
				size: r.bytes.byteLength,
				sha256: createHash('sha256').update(r.bytes).digest('hex')
			});
		}
	} catch (err) {
		await discardFiles(stored);
		throw err;
	}
	return stored;
}

export async function insertFiles(tx: Tx, ctx: TenantCtx, type: AttachmentOwner, ownerId: string, stored: Stored[]) {
	await assertRoom(tx, type, ownerId, stored.length);
	const rows = await tx
		.insert(files)
		.values(
			stored.map((s) => ({ tenantId: ctx.tenantId, ownerType: type, ownerId, uploadedByUserId: ctx.userId, ...s }))
		)
		.returning({ id: files.id });
	return rows.map((r) => r.id);
}

export async function addFiles(m: Member, type: AttachmentOwner, ownerId: string, list: File[]) {
	const ctx = salaryCtx(m);
	await withTenant(ctx, async (tx) => {
		await assertEditable(tx, m.access, type, ownerId, false);
		await assertRoom(tx, type, ownerId, list.filter((f) => f.size > 0).length);
	});
	const stored = await prepareFiles(m.tenant.id, type, list);
	try {
		return await withTenant(ctx, async (tx) => {
			await assertEditable(tx, m.access, type, ownerId, true);
			return insertFiles(tx, ctx, type, ownerId, stored);
		});
	} catch (err) {
		await discardFiles(stored);
		throw err;
	}
}

type Owner = { type: AttachmentOwner; id: string };

async function fileRow(tx: Tx, fileId: string, owner?: Owner, lock = false) {
	if (!isId(fileId)) throw notFound();
	const q = tx.select().from(files).where(eq(files.id, fileId));
	const [f] = lock ? await q.for('update') : await q;
	if (!f || (owner && (f.ownerType !== owner.type || f.ownerId !== owner.id))) throw notFound();
	return { ...f, ownerType: f.ownerType as AttachmentOwner };
}

export async function replaceFile(m: Member, owner: Owner, fileId: string, file: File) {
	const ctx = salaryCtx(m);
	const type = await withTenant(ctx, async (tx) => {
		const f = await fileRow(tx, fileId, owner);
		await assertEditable(tx, m.access, f.ownerType, f.ownerId, false);
		return f.ownerType;
	});
	const stored = await prepareFiles(m.tenant.id, type, [file]);
	let oldKey: string;
	let id: string;
	try {
		[oldKey, id] = await withTenant(ctx, async (tx) => {
			const f = await fileRow(tx, fileId, owner);
			await assertEditable(tx, m.access, f.ownerType, f.ownerId, true);
			const locked = await fileRow(tx, fileId, owner, true);
			await tx.delete(files).where(eq(files.id, locked.id));
			const [next] = await insertFiles(tx, ctx, locked.ownerType, locked.ownerId, stored);
			return [locked.key, next];
		});
	} catch (err) {
		await discardFiles(stored);
		throw err;
	}
	await deleteObject(oldKey).catch((err) => log.error({ err, key: oldKey }, 'attachment cleanup failed'));
	return id;
}

export async function removeFile(m: Member, owner: Owner, fileId: string) {
	const key = await withTenant(salaryCtx(m), async (tx) => {
		const f = await fileRow(tx, fileId, owner);
		await assertEditable(tx, m.access, f.ownerType, f.ownerId, true);
		const locked = await fileRow(tx, fileId, owner, true);
		await tx.delete(files).where(eq(files.id, locked.id));
		return locked.key;
	});
	await deleteObject(key).catch((err) => log.error({ err, key }, 'attachment cleanup failed'));
}

export async function listFiles(tx: Tx, access: Access, type: AttachmentOwner, ownerId: string) {
	if (!isId(ownerId) || !(await rules(type).canRead(tx, access, ownerId))) return null;
	const rows = await tx
		.select({ id: files.id, filename: files.filename, mime: files.mime, size: files.size, createdAt: files.createdAt })
		.from(files)
		.where(and(eq(files.ownerType, type), eq(files.ownerId, ownerId)))
		.orderBy(asc(files.createdAt), asc(files.id));
	return { files: rows, canEdit: await rules(type).canEdit(tx, access, ownerId, false) };
}

export async function openFile(m: Member, fileId: string) {
	const ctx = salaryCtx(m);
	const f = await withTenant(ctx, async (tx) => {
		const row = await fileRow(tx, fileId);
		if (!(await rules(row.ownerType).canRead(tx, m.access, row.ownerId))) throw notFound();
		await auditEvent(tx, ctx, 'files', row.id, 'file.download');
		return row;
	});
	return { fileName: f.filename, contentType: f.mime, body: await getObject(f.key) };
}

export { discardFiles, dropFiles, filesFor, type FileItem } from './file-store';
