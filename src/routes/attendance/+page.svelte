<script lang="ts">
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();

	function recordFor(employeeId: string) {
		return data.records.find((r) => r.employee_id === employeeId);
	}
</script>

<h1>Attendance — {data.date}</h1>

<form method="GET">
	<input type="date" name="date" value={data.date} onchange={(e) => e.currentTarget.form?.submit()} />
</form>

{#each data.employees as emp}
	{@const rec = recordFor(emp.id)}
	<form method="POST" action="?/mark">
		<input type="hidden" name="employee_id" value={emp.id} />
		<input type="hidden" name="work_date" value={data.date} />
		<span>{emp.full_name}</span>
		<select name="status">
			{#each ['present', 'late', 'absent', 'mc', 'leave'] as s}
				<option value={s} selected={rec?.status === s}>{s}</option>
			{/each}
		</select>
		<input name="hours_worked" type="number" step="0.5" placeholder="hours" value={rec?.hours_worked ?? ''} />
		<input name="missed_hours_reason" placeholder="reason if <8h" value={rec?.missed_hours_reason ?? ''} />
		<button type="submit">Save</button>
	</form>
{/each}
