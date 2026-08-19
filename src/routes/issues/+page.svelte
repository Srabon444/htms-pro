<script lang="ts">
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
</script>

<h1>Operational Issues</h1>

<form method="POST" action="?/create">
	<input name="issue" placeholder="Issue" required />
	<input name="solution" placeholder="Solution" />
	<input name="owner" placeholder="Owner" />
	<button type="submit">Log issue</button>
</form>

<ul>
	{#each data.issues as i}
		<li>
			[{i.status}] {i.issue} — {i.solution ?? 'no solution yet'} ({i.owner ?? 'unassigned'})
			{#if i.status === 'open'}
				<form method="POST" action="?/resolve" style="display:inline">
					<input type="hidden" name="id" value={i.id} />
					<button type="submit">Mark resolved</button>
				</form>
			{/if}
		</li>
	{/each}
</ul>
