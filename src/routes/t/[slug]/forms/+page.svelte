<script lang="ts">
	import Alert from '#lib/components/ui/Alert.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const p = $derived(data.page);
	const t = $derived(`/t/${data.tenant.slug}/forms`);
	const input = 'input px-2 py-1';
	const values = $derived((form && 'values' in form && form.values) || {});
	const EVERY: Record<string, string> = { once: 'Once', daily: 'Today', weekly: 'This week' };
	const STATUS: Record<string, string> = { draft: 'Draft', published: 'Published', archived: 'Archived' };
</script>

<svelte:head><title>Forms · {data.tenant.name}</title></svelte:head>

<h1 class="page-title">Forms</h1>
<div class="mt-4 max-w-3xl space-y-2">
	<Alert message={form?.message} />
	{#if data.sent}<Alert tone="info" message="Form sent." />{/if}
</div>

<section class="mt-4 max-w-3xl panel" aria-label="To fill">
	<h2 class="section-title">To fill</h2>
	{#if p.due.length}
		<ul class="mt-2 divide-y divide-slate-100 text-sm">
			{#each p.due as d (d.assignmentId)}
				<li class="flex flex-wrap items-center justify-between gap-2 py-2" data-testid="form-due">
					<span>{d.title} <span class="text-slate-400">· {EVERY[d.schedule]}</span></span>
					<a href={`${t}/fill/${d.assignmentId}`} class="font-medium text-brand-700 hover:underline">Fill {d.title}</a>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="mt-2 text-sm text-slate-600">Nothing to fill right now.</p>
	{/if}
</section>

{#if p.history.length}
	<section class="mt-6 max-w-3xl panel" aria-label="Sent">
		<h2 class="section-title">Sent</h2>
		<ul class="mt-2 divide-y divide-slate-100 text-sm">
			{#each p.history as h (h.id)}
				<li class="py-2" data-testid="form-sent">{h.title} · {h.period}</li>
			{/each}
		</ul>
	</section>
{/if}

{#if p.forms.length || p.manage}
	<section class="mt-6 max-w-3xl panel" aria-label="All forms">
		<h2 class="section-title">All forms</h2>
		{#if p.forms.length}
			<ul class="mt-2 divide-y divide-slate-100 text-sm">
				{#each p.forms as f (f.id)}
					<li class="flex flex-wrap items-center justify-between gap-2 py-2">
						<a href={`${t}/${f.id}`} class="font-medium text-brand-700 hover:underline">{f.title}</a>
						<span class="text-slate-500">{STATUS[f.status]} · {f.questions} question(s)</span>
					</li>
				{/each}
			</ul>
		{/if}
		{#if p.manage}
			<form method="POST" action="?/create" class="mt-3 space-y-2 text-sm">
				<label class="block text-slate-700">
					Title
					<input name="title" required maxlength="120" value={values.title ?? ''} class={`${input} block w-full`} />
				</label>
				<label class="block text-slate-700">
					Description (optional)
					<textarea name="description" maxlength="1000" rows="2" class={`${input} block w-full`}
						>{values.description ?? ''}</textarea
					>
				</label>
				<Button type="submit">Create form</Button>
			</form>
		{/if}
	</section>
{/if}
