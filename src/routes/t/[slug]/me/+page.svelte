<script lang="ts">
	import { money } from '#lib/money.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const t = $derived(`/t/${data.tenant.slug}`);
	const TABS = [
		['details', 'Details'],
		['payslips', 'Payslips'],
		['requests', 'My requests'],
		['activity', 'Activity']
	] as const;
	const label = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replaceAll('_', ' ');
	const d = $derived(data.details);
	const facts = $derived(
		d
			? [
					['Name', d.fullName],
					['Employee code', d.code],
					['Work email', d.workEmail],
					['Phone', d.phone],
					['Department', d.department],
					['Designation', d.designation],
					['Branch', d.branch],
					['Manager', d.manager],
					['Joined', d.joinDate],
					['Status', label(d.status)]
				]
			: []
	);
</script>

<svelte:head><title>Me · {data.tenant.name}</title></svelte:head>

<h1 class="page-title">Me</h1>
<nav class="mt-4 flex flex-wrap gap-2 text-sm" aria-label="Me sections">
	{#each TABS as [key, name] (key)}
		<a
			href={`${t}/me?tab=${key}`}
			aria-current={data.tab === key ? 'page' : undefined}
			class={[
				'rounded-lg px-3 py-1.5 ring-1 ring-inset',
				data.tab === key ? 'bg-brand-50 font-medium text-brand-800 ring-brand-200' : 'text-slate-600 ring-slate-200'
			]}
		>
			{name}
		</a>
	{/each}
</nav>

{#if data.tab === 'details'}
	<section class="mt-4 max-w-3xl panel" aria-label="Details">
		{#if d}
			<dl class="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
				{#each facts as [k, v] (k)}
					<div class="min-w-0">
						<dt class="text-xs text-slate-500">{k}</dt>
						<dd class="break-words text-slate-800">{v || '—'}</dd>
					</div>
				{/each}
			</dl>
			{#if d.canOpen}
				<a href={`${t}/employees/${d.id}`} class="mt-4 inline-block font-medium text-brand-700 hover:underline">
					Open my full profile to edit or request a change
				</a>
			{/if}
		{:else}
			<p class="text-sm text-slate-600">Your account is not linked to an employee record.</p>
		{/if}
	</section>
{:else if data.tab === 'payslips'}
	<section class="mt-4 max-w-3xl panel" aria-label="Payslips">
		{#if data.payslips.length}
			<ul class="divide-y divide-slate-100 text-sm">
				{#each data.payslips as p (p.id)}
					<li class="flex flex-wrap items-center justify-between gap-2 py-2" data-testid="me-payslip">
						<span class="text-slate-800">
							{p.period}{p.name ? ` · ${p.name}` : ''} · Net {money(p.net, p.currency)}
						</span>
						<a href={`${t}/payslips/${p.id}/pdf`} class="text-brand-700 hover:underline">
							Download PDF of {p.period}{p.name ? ` ${p.name}` : ''}
						</a>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="text-sm text-slate-600">No payslips yet. They appear here once payroll is paid.</p>
		{/if}
		<a href={`${t}/payslips`} class="mt-3 inline-block text-brand-700 hover:underline">Payslip settings</a>
	</section>
{:else if data.tab === 'requests'}
	{#if data.requests.length}
		{#each data.requests as g (g.key)}
			<section class="mt-4 max-w-3xl panel" aria-label={g.title}>
				<div class="flex flex-wrap items-center justify-between gap-2">
					<h2 class="section-title">{g.title}</h2>
					<a href={`${t}/${g.link}`} class="text-sm text-brand-700 hover:underline">Open {g.title}</a>
				</div>
				{#if g.items.length}
					<ul class="mt-2 divide-y divide-slate-100 text-sm">
						{#each g.items as r (r.id)}
							<li class="flex flex-wrap items-center justify-between gap-2 py-2" data-testid="me-request">
								<a href={`${t}/${r.link}`} class="min-w-0 break-words text-slate-800 hover:underline">{r.label}</a>
								<span class="text-slate-500">{label(r.status)} · {r.on}</span>
							</li>
						{/each}
					</ul>
				{:else}
					<p class="mt-2 text-sm text-slate-600">Nothing yet.</p>
				{/if}
			</section>
		{/each}
		<p class="mt-2 max-w-3xl text-xs text-slate-500">The latest 20 of each kind.</p>
	{:else}
		<p class="mt-4 text-sm text-slate-600">Your account is not linked to an employee record.</p>
	{/if}
{:else}
	<section class="mt-4 max-w-3xl panel" aria-label="Activity">
		<p class="text-xs text-slate-500">What you did in this workspace. Values are never shown here.</p>
		{#if data.activity.entries.length}
			<ul class="mt-2 divide-y divide-slate-100 text-sm">
				{#each data.activity.entries as e (e.id)}
					<li class="flex flex-wrap justify-between gap-2 py-2" data-testid="me-activity">
						<span class="text-slate-800">{e.action} · {e.what}</span>
						<span class="text-slate-500">{e.at}</span>
					</li>
				{/each}
			</ul>
			{#if data.activity.next}
				<a
					href={`${t}/me?tab=activity&before=${data.activity.next}`}
					class="mt-3 inline-block text-brand-700 hover:underline"
				>
					Older activity
				</a>
			{/if}
		{:else}
			<p class="mt-2 text-sm text-slate-600">No activity yet.</p>
		{/if}
	</section>
{/if}
