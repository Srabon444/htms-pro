<script lang="ts">
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
</script>

<h1>Departments</h1>

<form method="POST" action="?/create">
	<input name="name" placeholder="Department name" required />
	<button type="submit">Add</button>
</form>

<ul>
	{#each data.departments as dept}
		<li>
			{dept.name}
			<form method="POST" action="?/delete" style="display:inline">
				<input type="hidden" name="id" value={dept.id} />
				<button type="submit">Delete</button>
			</form>
		</li>
	{/each}
</ul>
