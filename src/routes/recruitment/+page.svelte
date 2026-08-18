<script lang="ts">
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
</script>

<h1>Recruitment</h1>

<form method="POST" action="?/create">
	<input name="title" placeholder="Job title" required />
	<input name="target_headcount" type="number" min="1" value="1" required />
	<button type="submit">Create opening</button>
</form>

<ul>
	{#each data.openings as o}
		<li>
			<a href={`/recruitment/${o.id}`}>{o.title}</a> — target {o.target_headcount} — {o.status}
		</li>
	{/each}
</ul>
