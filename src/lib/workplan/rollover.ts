export type WorkPlanStatus = 'pending' | 'in_progress' | 'done';

export type WorkPlanItem = {
	id: string;
	description: string;
	target_value: string | null;
	owner: string | null;
	status: WorkPlanStatus;
};

export type NewWorkPlanItemInput = {
	description: string;
	target_value: string | null;
	owner: string | null;
	week_start: string;
	carried_over_from: string;
};

export function rolloverIncomplete(items: WorkPlanItem[], newWeekStart: string): NewWorkPlanItemInput[] {
	return items
		.filter((item) => item.status !== 'done')
		.map((item) => ({
			description: item.description,
			target_value: item.target_value,
			owner: item.owner,
			week_start: newWeekStart,
			carried_over_from: item.id
		}));
}
