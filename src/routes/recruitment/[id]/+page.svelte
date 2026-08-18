<script lang="ts">
	import { computeFunnel } from '$lib/report/funnel';
	import Chart from '$lib/components/Chart.svelte';
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();

	let funnel = $derived(computeFunnel(data.stages, data.candidates));
</script>

<h1>{data.opening.title}</h1>
<p>Target: {data.opening.target_headcount}</p>

<h2>Pipeline stages</h2>
<form method="POST" action="?/addStage">
	<input name="name" placeholder="New stage name" required />
	<button type="submit">Add stage</button>
</form>

<table>
	<thead><tr><th>Stage</th><th>Count</th></tr></thead>
	<tbody>
		{#each funnel as f}
			<tr><td>{f.stageName}</td><td>{f.count}</td></tr>
		{/each}
	</tbody>
</table>

<Chart type="bar" labels={funnel.map((f) => f.stageName)} data={funnel.map((f) => f.count)} label="Candidates" />

<h2>Candidates</h2>
<form method="POST" action="?/addCandidate">
	<input name="name" placeholder="Candidate name" required />
	<select name="source">
		<option value="application">Application</option>
		<option value="linkedin_headhunt">LinkedIn headhunt</option>
		<option value="referral">Referral</option>
		<option value="other">Other</option>
	</select>
	<select name="stage_id">
		{#each data.stages as s}<option value={s.id}>{s.name}</option>{/each}
	</select>
	<button type="submit">Add candidate</button>
</form>

<ul>
	{#each data.candidates as c}
		<li>
			{c.name} ({c.source})
			<form method="POST" action="?/moveCandidate" style="display:inline">
				<input type="hidden" name="candidate_id" value={c.id} />
				<select name="stage_id">
					{#each data.stages as s}
						<option value={s.id} selected={c.current_stage_id === s.id}>{s.name}</option>
					{/each}
				</select>
				<button type="submit">Move</button>
			</form>
		</li>
	{/each}
</ul>
