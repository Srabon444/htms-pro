import { describe, it, expect } from 'vitest';
import { rolloverIncomplete, type WorkPlanItem } from './rollover';

describe('rolloverIncomplete', () => {
	it('carries forward pending and in_progress items with a link to the original', () => {
		const items: WorkPlanItem[] = [
			{ id: '1', description: 'Get 200 resumes', target_value: '200', owner: 'Monir', status: 'pending' },
			{ id: '2', description: 'Headhunt 5 devs', target_value: '5', owner: 'Monir', status: 'in_progress' },
			{ id: '3', description: 'Fix wifi', target_value: null, owner: 'Fahim', status: 'done' }
		];

		expect(rolloverIncomplete(items, '2026-08-25')).toEqual([
			{ description: 'Get 200 resumes', target_value: '200', owner: 'Monir', week_start: '2026-08-25', carried_over_from: '1' },
			{ description: 'Headhunt 5 devs', target_value: '5', owner: 'Monir', week_start: '2026-08-25', carried_over_from: '2' }
		]);
	});

	it('returns an empty array when everything is done', () => {
		const items: WorkPlanItem[] = [
			{ id: '1', description: 'Fix wifi', target_value: null, owner: 'Fahim', status: 'done' }
		];
		expect(rolloverIncomplete(items, '2026-08-25')).toEqual([]);
	});
});
