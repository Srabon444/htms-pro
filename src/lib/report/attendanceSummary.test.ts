import { describe, it, expect } from 'vitest';
import { summarizeAttendance, type AttendanceRecord } from './attendanceSummary';

describe('summarizeAttendance', () => {
	it('counts each status and flags employees under 8 hours', () => {
		const records: AttendanceRecord[] = [
			{ employee_id: 'a', status: 'present', hours_worked: 8, missed_hours_reason: null },
			{ employee_id: 'b', status: 'late', hours_worked: 6, missed_hours_reason: 'traffic' },
			{ employee_id: 'c', status: 'absent', hours_worked: null, missed_hours_reason: null },
			{ employee_id: 'd', status: 'mc', hours_worked: null, missed_hours_reason: null },
			{ employee_id: 'e', status: 'leave', hours_worked: null, missed_hours_reason: null }
		];

		const summary = summarizeAttendance(records);

		expect(summary).toEqual({
			present: 1,
			late: 1,
			absent: 1,
			mc: 1,
			leave: 1,
			missedHours: [{ employeeId: 'b', reason: 'traffic' }]
		});
	});

	it('returns all zeros and no flags for an empty list', () => {
		expect(summarizeAttendance([])).toEqual({
			present: 0,
			late: 0,
			absent: 0,
			mc: 0,
			leave: 0,
			missedHours: []
		});
	});
});
