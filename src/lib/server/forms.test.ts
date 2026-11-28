import { describe, expect, it } from 'vitest';
import type { FormField } from './db/schema';
import { answerSchema, periodFor } from './forms';

const plan = (schedule: 'once' | 'daily' | 'weekly', weekday: number | null = null, endsOn: string | null = null) => ({
	schedule,
	weekday,
	startsOn: '2026-12-01',
	endsOn
});

describe('periodFor', () => {
	it('is empty outside the assignment window', () => {
		expect(periodFor(plan('daily'), '2026-11-30')).toBeNull();
		expect(periodFor(plan('daily', null, '2026-12-05'), '2026-12-06')).toBeNull();
		expect(periodFor(plan('daily', null, '2026-12-05'), '2026-12-05')).toBe('2026-12-05');
	});

	it('uses the start for once and the day for daily', () => {
		expect(periodFor(plan('once'), '2026-12-20')).toBe('2026-12-01');
		expect(periodFor(plan('daily'), '2026-12-20')).toBe('2026-12-20');
	});

	it('uses the latest chosen weekday, and the start date for the first part week', () => {
		expect(periodFor(plan('weekly', 1), '2026-12-07')).toBe('2026-12-07');
		expect(periodFor(plan('weekly', 1), '2026-12-09')).toBe('2026-12-07');
		expect(periodFor(plan('weekly', 3), '2026-12-08')).toBe('2026-12-02');
		expect(periodFor(plan('weekly', 1), '2026-12-03')).toBe('2026-12-01');
		expect(periodFor(plan('weekly', 1), '2026-12-06')).toBe('2026-12-01');
	});
});

const field = (kind: FormField['kind'], required = true, options: string[] = []): FormField => ({
	id: `f_${kind}${required ? '' : '_optional'}`,
	kind,
	label: kind,
	required,
	options
});

describe('answerSchema', () => {
	const issue = (fields: FormField[], raw: Record<string, unknown>) =>
		answerSchema(fields).safeParse(raw).error?.issues[0].message;

	it('checks each kind of answer', () => {
		const fields = [
			field('text'),
			field('number'),
			field('date'),
			field('select', true, ['Yes', 'No']),
			field('multi', true, ['A', 'B']),
			field('checkbox'),
			field('checkbox', false),
			field('acknowledge'),
			field('photo')
		];
		const ok = {
			f_text: ' Fine ',
			f_number: '12.5',
			f_date: '2026-12-01',
			f_select: 'No',
			f_multi: ['A', 'A', 'B'],
			f_checkbox: 'no',
			f_acknowledge: 'on'
		};
		expect(answerSchema(fields).parse(ok)).toEqual({
			f_text: 'Fine',
			f_number: 12.5,
			f_date: '2026-12-01',
			f_select: 'No',
			f_multi: ['A', 'B'],
			f_checkbox: false,
			f_checkbox_optional: null,
			f_acknowledge: true
		});
		expect(issue(fields, { ...ok, f_checkbox: '' })).toBe('Answer "checkbox".');
		expect(issue(fields, { ...ok, f_checkbox: 'on' })).toBe('Answer "checkbox".');
		expect(issue(fields, { ...ok, f_text: new File(['x'], 'x.txt') })).toMatch(/./);
		expect(answerSchema(fields).parse({ ...ok, f_checkbox: 'yes', f_checkbox_optional: 'yes' })).toMatchObject({
			f_checkbox: true,
			f_checkbox_optional: true
		});
		expect(issue(fields, { ...ok, f_text: '' })).toBe('Answer "text".');
		expect(issue(fields, { ...ok, f_number: '1e5' })).toBe('Enter a number for "number".');
		expect(issue(fields, { ...ok, f_number: '9999999999' })).toBe('Enter a smaller number for "number".');
		expect(issue(fields, { ...ok, f_date: '2150-01-01' })).toBe('Choose a date between 2000 and 2099.');
		expect(issue(fields, { ...ok, f_select: 'Maybe' })).toBe('Choose an answer for "select".');
		expect(issue(fields, { ...ok, f_multi: ['C'] })).toBe('Choose an answer for "multi".');
		expect(issue(fields, { ...ok, f_multi: [] })).toBe('Choose at least one answer for "multi".');
		expect(issue(fields, { ...ok, f_acknowledge: undefined })).toBe('Confirm "acknowledge".');
		expect(issue(fields, { ...ok, f_text: 'x'.repeat(2001) })).toBe('Keep "text" under 2000 characters.');
	});

	it('stores skipped optional answers as empty', () => {
		const fields = [
			field('text', false),
			field('number', false),
			field('select', false, ['A', 'B']),
			field('multi', false, ['A', 'B'])
		];
		expect(answerSchema(fields).parse({ f_multi_optional: [] })).toEqual({
			f_text_optional: null,
			f_number_optional: null,
			f_select_optional: null,
			f_multi_optional: []
		});
		expect(
			answerSchema(fields).parse({ f_text_optional: '   ', f_number_optional: ' ', f_multi_optional: [] })
		).toMatchObject({ f_text_optional: null, f_number_optional: null });
	});

	it('requires a yes or no answer to a required yes/no question', () => {
		expect(issue([field('checkbox')], {})).toBe('Answer "checkbox".');
	});
});
