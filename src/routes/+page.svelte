<script lang="ts">
	import FilterBar from '$lib/components/FilterBar.svelte';
	import Chart from '$lib/components/Chart.svelte';
	import ShareExportBar from '$lib/components/ShareExportBar.svelte';
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
</script>

<h1>Weekly Management Report</h1>

<FilterBar departments={data.departments} />

<div id="weekly-report">
	<h2>Office Attendance Summary ({data.filters.from} to {data.filters.to})</h2>
	<ul>
		<li>Present: {data.attendanceSummary.present}</li>
		<li>Late: {data.attendanceSummary.late}</li>
		<li>Absent: {data.attendanceSummary.absent}</li>
		<li>MC: {data.attendanceSummary.mc}</li>
		<li>Leave: {data.attendanceSummary.leave}</li>
	</ul>
	{#if data.attendanceSummary.missedHours.length > 0}
		<h3>Did not do 8 hours</h3>
		<ul>
			{#each data.attendanceSummary.missedHours as m}
				<li>{m.employeeId}: {m.reason ?? 'no reason given'}</li>
			{/each}
		</ul>
	{/if}

	<h2>Recruitment Progress</h2>
	{#each data.funnels as f}
		<h3>{f.title}</h3>
		<Chart type="bar" labels={f.funnel.map((s) => s.stageName)} data={f.funnel.map((s) => s.count)} label={f.title} />
	{/each}

	<h2>New Hires</h2>
	<ul>
		{#each data.newHires as h}
			<li>{h.position_title} — starts {h.start_date}</li>
		{/each}
	</ul>

	<h2>Operational Issues</h2>
	<ul>
		{#each data.issues as i}
			<li>[{i.status}] {i.issue} — {i.solution ?? 'no solution yet'} ({i.owner ?? 'unassigned'})</li>
		{/each}
	</ul>

	<h2>Next Week Work Plan</h2>
	<ul>
		{#each data.workPlanItems as w}
			<li>{w.description} — target {w.target_value ?? 'n/a'} — {w.status}</li>
		{/each}
	</ul>
</div>

<ShareExportBar targetId="weekly-report" filename="weekly-management-report" />
