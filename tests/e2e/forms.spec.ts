import { expect, test, type Page } from '@playwright/test';
import { fixture, signIn } from './fixtures';

const PHONE = { width: 390, height: 844 };
const fits = async (page: Page) =>
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(PHONE.width);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

test('HR builds a daily form, an employee fills it with a photo, HR reads it, and a manager hands out a task', async ({
	browser,
	request
}) => {
	test.setTimeout(120_000);
	const f = await fixture(request, {
		tenant: {},
		users: [
			{ key: 'own', roles: ['owner'] },
			{ key: 'mgr', roles: ['line_manager', 'employee'], employee: true },
			{ key: 'ana', roles: ['employee'], employee: true, manager: 'mgr' }
		]
	});
	const t = `/t/${f.tenant!.slug}`;
	const page = await (await browser.newContext({ viewport: PHONE })).newPage();
	const ready = () => page.locator('html[data-hydrated]').waitFor({ state: 'attached' });
	const as = async (key: string, path: string) => {
		await page.context().clearCookies();
		await signIn(page, f.users[key].email);
		await page.goto(`${t}/${path}`);
		await ready();
	};
	const status = page.getByRole('status');

	await as('own', 'settings/modules');
	expect((await page.goto(`${t}/forms`))!.status()).toBe(404);
	await page.goto(`${t}/settings/modules`);
	await ready();
	await page.getByLabel('Forms and checklists').check();
	await page.getByRole('button', { name: 'Save modules' }).click();
	await expect(page.getByText('Modules saved.')).toBeVisible();

	await as('own', 'forms');
	await page.getByLabel('Title').fill('Shop opening');
	await page.getByRole('button', { name: 'Create form' }).click();
	await page.waitForURL(/\/forms\/[0-9a-f-]{36}$/);
	await ready();
	const formUrl = new URL(page.url()).pathname;
	const questions = page.getByRole('region', { name: 'Questions' });
	const ask = async (label: string, kind: string, required: boolean, choices = '') => {
		await questions.getByLabel('Question').fill(label);
		await questions.getByLabel('Answer').selectOption({ label: kind });
		if (choices) await questions.getByLabel('Choices, one per line').fill(choices);
		await questions.getByLabel('Required').setChecked(required);
		await questions.getByRole('button', { name: 'Add question' }).click();
		await expect(status).toHaveText('Question added.');
		await ready();
	};
	await ask('Customers waiting', 'Number', true);
	await ask('Doors', 'One choice', true, 'Open\nLocked');
	await ask('Shelf photo', 'Photo', true);
	await ask('Gate locked', 'Yes / no', true);
	await expect(page.getByTestId('question')).toHaveCount(4);
	await page.getByRole('button', { name: 'Publish form' }).click();
	await expect(page.getByTestId('form-status')).toHaveText('Published · 4 question(s)');
	await ready();
	const assign = page.getByRole('region', { name: 'Assignments' });
	await assign.getByLabel('How often').selectOption({ label: 'Every day' });
	const today = (await assign.getByLabel('Starts on').getAttribute('min'))!;
	await assign.getByLabel('Starts on').fill(today);
	await assign.getByRole('button', { name: 'Assign form' }).click();
	await expect(status).toHaveText('Form assigned.');
	await expect(page.getByTestId('assignment')).toContainText(`Everyone · Every day · from ${today}`);
	await fits(page);

	await as('ana', 'forms');
	await page.getByRole('link', { name: 'Fill Shop opening' }).click();
	await ready();
	await page.getByLabel(/^Customers waiting/).fill('lots');
	await page.getByLabel(/^Doors/).selectOption('Open');
	await page
		.getByRole('group', { name: /^Gate locked/ })
		.getByLabel('No')
		.check();
	await page.getByLabel(/^Shelf photo/).setInputFiles({ name: 'shelf.png', mimeType: 'image/png', buffer: PNG });
	await fits(page);
	await page.getByRole('button', { name: 'Send form' }).click();
	expect(await page.getByLabel(/^Customers waiting/).evaluate((el: HTMLInputElement) => el.validity.valid)).toBe(false);
	await page.getByLabel(/^Customers waiting/).fill('12');
	await page.getByRole('button', { name: 'Send form' }).click();
	await page.waitForURL(/\/forms\?sent=1$/);
	await expect(status).toHaveText('Form sent.');
	await expect(page.getByTestId('form-sent')).toHaveText(`Shop opening · ${today}`);
	await expect(page.getByTestId('form-due')).toHaveCount(0);
	expect((await page.goto(`${t}${formUrl.slice(t.length)}`))!.status()).toBe(404);

	await as('own', formUrl.slice(t.length + 1));
	const s = page.getByTestId('submission');
	await expect(s).toHaveCount(1);
	await expect(s).toContainText(/ana/);
	await expect(s).toContainText('12');
	await expect(s).toContainText('Open');
	await expect(s.getByText('Gate locked').locator('..').locator('dd')).toHaveText('No');
	const photo = s.getByRole('link', { name: 'shelf.png' });
	const res = await page.request.get(new URL((await photo.getAttribute('href'))!, page.url()).href);
	expect(res.status()).toBe(200);
	expect(res.headers()['content-type']).toContain('image/png');
	await fits(page);

	await as('mgr', 'tasks');
	const create = page.getByRole('region', { name: 'New task' });
	await create.getByLabel('Title').fill('Count the till');
	const ana = await create.getByLabel('For').locator('option', { hasText: /^ana/ }).getAttribute('value');
	await create.getByLabel('For').selectOption(ana!);
	await create.getByLabel('Due (optional)').fill(today);
	await create.getByRole('button', { name: 'Add task' }).click();
	await expect(status).toHaveText('Task added.');
	await expect(page.getByRole('region', { name: 'Given by me' }).getByTestId('task')).toContainText('Count the till');
	await fits(page);

	await as('ana', 'tasks');
	const mine = page.getByRole('region', { name: 'Given to me' });
	await expect(mine.getByTestId('task')).toContainText(`due ${today}`);
	await expect(mine.getByRole('button', { name: 'Delete Count the till' })).toHaveCount(0);
	await mine.getByRole('button', { name: 'Mark Count the till done' }).click();
	await expect(status).toHaveText('Task done.');
	await expect(mine.getByRole('button', { name: 'Reopen Count the till' })).toBeVisible();
	await fits(page);
});
