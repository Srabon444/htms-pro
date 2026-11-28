import { expect, test, type Page } from '@playwright/test';
import { fixture, signIn } from './fixtures';

const PHONE = { width: 390, height: 844 };
const fits = async (page: Page) =>
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(PHONE.width);

test('HR writes a knowledge base article in a folder and an employee finds and reads it', async ({
	browser,
	request
}) => {
	test.setTimeout(90_000);
	const f = await fixture(request, {
		tenant: {},
		users: [
			{ key: 'hr', roles: ['hr_admin'], employee: true },
			{ key: 'ela', roles: ['employee'], employee: true }
		]
	});
	const t = `/t/${f.tenant!.slug}`;
	const hr = await (await browser.newContext({ viewport: PHONE })).newPage();
	const ready = (p: Page) => p.locator('html[data-hydrated]').waitFor({ state: 'attached' });
	await signIn(hr, f.users.hr.email);
	await hr.goto(`${t}/knowledge`);
	await ready(hr);
	const newFolder = hr.getByRole('region', { name: 'New folder' });
	await newFolder.getByLabel('Folder name').fill('Handbook');
	await newFolder.getByRole('button', { name: 'Add folder' }).click();
	await hr.waitForURL(/folder=/);
	await ready(hr);
	await expect(hr.getByRole('navigation', { name: 'Folder path' })).toContainText('Handbook');
	await hr.getByRole('region', { name: 'New article' }).getByLabel('Title').fill('Carrying leave over');
	await hr.getByRole('button', { name: 'Create draft' }).click();
	await hr.waitForURL(/\/knowledge\/[0-9a-f-]{36}\?edit=1$/);
	await ready(hr);
	const edit = hr.getByRole('region', { name: 'Edit article' });
	await edit.getByLabel('Article').fill('# How it works\n\nYou can carry **five days** into next year.\n- Ask HR');
	await edit.getByLabel('Status').selectOption('published');
	await edit.getByRole('button', { name: 'Save article' }).click();
	await hr.waitForURL(/\/knowledge\/[0-9a-f-]{36}$/);
	await ready(hr);
	await expect(hr.locator('article strong')).toHaveText('five days');
	await fits(hr);
	await hr.goto(`${t}/knowledge`);
	await ready(hr);
	await hr.getByRole('region', { name: 'New article' }).getByLabel('Title').fill('Secret plan');
	await hr.getByRole('button', { name: 'Create draft' }).click();
	await hr.waitForURL(/\?edit=1$/);

	const page = await (await browser.newContext({ viewport: PHONE })).newPage();
	await signIn(page, f.users.ela.email);
	await page.goto(t);
	await ready(page);
	await page.goto(`${t}/knowledge`);
	await ready(page);
	await expect(page.getByRole('region', { name: 'New folder' })).toHaveCount(0);
	await expect(page.getByRole('region', { name: 'Articles' })).not.toContainText('Secret plan');
	await page.getByTestId('kb-folder').filter({ hasText: 'Handbook' }).click();
	await page.waitForURL(/folder=/);
	await ready(page);
	await page.getByRole('link', { name: 'Grid' }).click();
	await page.waitForURL(/view=grid/);
	await expect(page.getByTestId('kb-article')).toContainText('You can carry five days into next year.');
	await fits(page);
	await page.getByRole('searchbox', { name: 'Search articles and policies' }).fill('next year');
	await page.getByRole('search', { name: 'Knowledge base search' }).getByRole('button', { name: 'Search' }).click();
	await page.waitForURL(/q=next/);
	await ready(page);
	await expect(page.getByTestId('kb-article')).toContainText('In Handbook');
	await page.getByRole('link', { name: 'Carrying leave over' }).click();
	await page.waitForURL(/\/knowledge\/[0-9a-f-]{36}$/);
	await ready(page);
	await expect(page.getByRole('heading', { name: 'How it works' })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Edit article' })).toHaveCount(0);
	await fits(page);
});
