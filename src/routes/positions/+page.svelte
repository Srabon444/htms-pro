<script lang="ts">
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
</script>

<h1>Positions</h1>

<form method="POST" action="?/create">
	<input name="title" placeholder="Position title" required />
	<select name="department_id">
		<option value="">No department</option>
		{#each data.departments as dept}
			<option value={dept.id}>{dept.name}</option>
		{/each}
	</select>
	<button type="submit">Add</button>
</form>

<ul>
	{#each data.positions as pos}
		<li>
			<!-- ponytail: untyped supabase client infers embedded *-to-one as an array; cast to the real runtime shape -->
			{pos.title} — {(pos.hrms_departments as unknown as { name: string } | null)?.name ??
				'Unassigned'}
			<form method="POST" action="?/delete" style="display:inline">
				<input type="hidden" name="id" value={pos.id} />
				<button type="submit">Delete</button>
			</form>
		</li>
	{/each}
</ul>
