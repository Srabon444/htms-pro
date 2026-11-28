import { expect, test, type Page } from '@playwright/test';
import { fixture, signIn } from './fixtures';

const PHONE = { width: 390, height: 844 };
const fits = async (page: Page) =>
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(PHONE.width);
const workday = (offset: number) => {
	const d = new Date(Date.now() + offset * 86_400_000);
	while ([5, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
	return d.toISOString().slice(0, 10);
};

test('an employee sees their details, requests and own activity on the Me page', async ({ browser, request }) => {
	test.setTimeout(90_000);
	const f = await fixture(request, {
		tenant: {},
		users: [
			{ key: 'boss', roles: ['line_manager'], employee: true },
			{ key: 'ela', roles: ['employee'], employee: true, manager: 'boss' }
		]
	});
	const t = `/t/${f.tenant!.slug}`;
	const page = await (await browser.newContext({ viewport: PHONE })).newPage();
	const ready = () => page.locator('html[data-hydrated]').waitFor({ state: 'attached' });
	await signIn(page, f.users.ela.email);
	const date = workday(7);
	await page.goto(`${t}/attendance`);
	await ready();
	const ask = page.getByRole('region', { name: 'Ask for a change' });
	await ask.getByRole('combobox').selectOption({ label: 'Work from home' });
	await ask.getByLabel('Day', { exact: true }).fill(date);
	await ask.getByLabel('Reason').fill('Plumber visit');
	await ask.getByRole('button', { name: 'Send request' }).click();
	await expect(page.getByRole('status')).toHaveText('Request sent.');

	await page.goto(`${t}/me`);
	await ready();
	const details = page.getByRole('region', { name: 'Details' });
	await expect(details.getByText(/^ela/).first()).toBeVisible();
	await expect(details).toContainText(/Manager\s*boss/);
	await fits(page);
	await details.getByRole('link', { name: 'Open my full profile to edit or request a change' }).click();
	await page.waitForURL(/\/employees\/[0-9a-f-]{36}$/);

	await page.goto(`${t}/me`);
	await ready();
	await page.getByRole('navigation', { name: 'Me sections' }).getByRole('link', { name: 'My requests' }).click();
	await page.waitForURL(/tab=requests/);
	await expect(page.getByRole('link', { name: 'My requests' })).toHaveAttribute('aria-current', 'page');
	const attendance = page.getByRole('region', { name: 'Attendance requests' });
	await expect(attendance.getByTestId('me-request')).toContainText(`Work from home on ${date}`);
	await expect(attendance.getByTestId('me-request')).toContainText('Pending');
	await expect(page.getByRole('region', { name: 'Leave' })).toContainText('Nothing yet.');
	await fits(page);

	await page.getByRole('link', { name: 'Activity' }).click();
	await page.waitForURL(/tab=activity/);
	const activity = page.getByRole('region', { name: 'Activity' });
	await expect(activity.getByTestId('me-activity').first()).toContainText('Created · Attendance request');
	await expect(activity).not.toContainText('Plumber visit');
	await fits(page);

	await page.getByRole('link', { name: 'Payslips' }).click();
	await page.waitForURL(/tab=payslips/);
	await expect(page.getByRole('region', { name: 'Payslips' })).toContainText('No payslips yet.');
	await fits(page);
});
