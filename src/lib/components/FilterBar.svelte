<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { buildFilterUrl, parseFilters, type ReportFilters } from '$lib/filters/urlFilters';

	let { departments = [] } = $props<{ departments: { id: string; name: string }[] }>();

	let filters: ReportFilters = $state(parseFilters($page.url.searchParams));

	function apply() {
		goto(buildFilterUrl($page.url.pathname, filters));
	}
</script>

<div class="filter-bar">
	<input type="date" bind:value={filters.from} />
	<input type="date" bind:value={filters.to} />
	<select bind:value={filters.departmentId}>
		<option value={null}>All departments</option>
		{#each departments as d}<option value={d.id}>{d.name}</option>{/each}
	</select>
	<button onclick={apply}>Apply filters</button>
</div>
