<script lang="ts">
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
</script>

<h1>Employees</h1>

<form method="POST" action="?/create">
	<input name="full_name" placeholder="Full name" required />
	<select name="department_id">
		<option value="">No department</option>
		{#each data.departments as d}<option value={d.id}>{d.name}</option>{/each}
	</select>
	<select name="position_id">
		<option value="">No position</option>
		{#each data.positions as p}<option value={p.id}>{p.title}</option>{/each}
	</select>
	<select name="employment_type" required>
		<option value="full_time">Full-time</option>
		<option value="part_time">Part-time</option>
		<option value="intern">Intern</option>
		<option value="contract">Contract</option>
	</select>
	<input name="join_date" type="date" required />
	<input name="emergency_contact_name" placeholder="Emergency contact name" />
	<input name="emergency_contact_phone" placeholder="Emergency contact phone" />
	<button type="submit">Add employee</button>
</form>

<ul>
	{#each data.employees as e}
		<li>
			<a href={`/employees/${e.id}`}>{e.full_name}</a>
			<!-- ponytail: untyped supabase client infers embedded *-to-one as an array; cast to the real runtime shape -->
			— {(e.hrms_departments as unknown as { name: string } | null)?.name ?? 'Unassigned'} / {(
				e.hrms_positions as unknown as { title: string } | null
			)?.title ?? 'Unassigned'}
			— {e.status}
		</li>
	{/each}
</ul>
