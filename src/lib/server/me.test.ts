import { expect, it } from 'vitest';
import { ACTIVITY_TABLES, tabOf } from './me';

it('falls back to the details tab', () => {
	expect(tabOf('activity')).toBe('activity');
	expect(tabOf('salaries')).toBe('details');
	expect(tabOf(null)).toBe('details');
});

it('never lists anonymous, salary or audit tables as activity', () => {
	for (const t of [
		'survey_responses',
		'suggestions',
		'salary_changes',
		'employee_salaries',
		'comp_proposals',
		'payslips',
		'audit_sensitive',
		'feedback_notes'
	])
		expect(ACTIVITY_TABLES[t]).toBeUndefined();
});
