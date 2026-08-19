<script lang="ts">
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();

	function nextWeek(weekStart: string): string {
		const d = new Date(weekStart);
		d.setUTCDate(d.getUTCDate() + 7);
		return d.toISOString().slice(0, 10);
	}
</script>

<h1>Work Plan — week of {data.weekStart}</h1>

<form method="POST" action="?/create">
	<input type="hidden" name="week_start" value={data.weekStart} />
	<input name="description" placeholder="Action item" required />
	<input name="target_value" placeholder="Target (e.g. 200)" />
	<input name="owner" placeholder="Owner" />
	<button type="submit">Add</button>
</form>

<ul>
	{#each data.items as item}
		<li>
			{item.description} — target {item.target_value ?? 'n/a'} — {item.owner ?? 'unassigned'} — {item.status}
			<form method="POST" action="?/updateStatus" style="display:inline">
				<input type="hidden" name="id" value={item.id} />
				<select name="status" onchange={(e) => e.currentTarget.form?.requestSubmit()}>
					<option value="pending" selected={item.status === 'pending'}>Pending</option>
					<option value="in_progress" selected={item.status === 'in_progress'}>In progress</option>
					<option value="done" selected={item.status === 'done'}>Done</option>
				</select>
			</form>
		</li>
	{/each}
</ul>

<form method="POST" action="?/startNewWeek">
	<input type="hidden" name="current_week" value={data.weekStart} />
	<input type="hidden" name="next_week" value={nextWeek(data.weekStart)} />
	<button type="submit">Start next week (roll over incomplete items)</button>
</form>
