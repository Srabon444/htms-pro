export type AttendanceStatus = 'present' | 'late' | 'absent' | 'mc' | 'leave';

export type AttendanceRecord = {
	employee_id: string;
	status: AttendanceStatus;
	hours_worked: number | null;
	missed_hours_reason: string | null;
};

export type AttendanceSummary = {
	present: number;
	late: number;
	absent: number;
	mc: number;
	leave: number;
	missedHours: { employeeId: string; reason: string | null }[];
};

const FULL_DAY_HOURS = 8;

export function summarizeAttendance(records: AttendanceRecord[]): AttendanceSummary {
	const summary: AttendanceSummary = {
		present: 0,
		late: 0,
		absent: 0,
		mc: 0,
		leave: 0,
		missedHours: []
	};

	for (const record of records) {
		summary[record.status] += 1;
		if (record.hours_worked !== null && record.hours_worked < FULL_DAY_HOURS) {
			summary.missedHours.push({ employeeId: record.employee_id, reason: record.missed_hours_reason });
		}
	}

	return summary;
}
