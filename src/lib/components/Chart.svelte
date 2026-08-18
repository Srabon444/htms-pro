<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { Chart, registerables } from 'chart.js';

	Chart.register(...registerables);

	let {
		type = 'bar',
		labels,
		data,
		label
	}: { type?: 'bar' | 'line'; labels: string[]; data: number[]; label: string } = $props();

	let canvas: HTMLCanvasElement;
	let chart: Chart;

	onMount(() => {
		chart = new Chart(canvas, {
			type,
			data: { labels, datasets: [{ label, data }] },
			options: { responsive: true, maintainAspectRatio: false }
		});
	});

	$effect(() => {
		if (chart) {
			chart.data.labels = labels;
			chart.data.datasets[0].data = data;
			chart.update();
		}
	});

	onDestroy(() => chart?.destroy());
</script>

<!-- Chart.js responsive sizing reads the canvas's containing block; the app shell's
     display:contents wrapper collapses that box to 0x0 without this explicit size. -->
<div style="position: relative; height: 300px;">
	<canvas bind:this={canvas}></canvas>
</div>
