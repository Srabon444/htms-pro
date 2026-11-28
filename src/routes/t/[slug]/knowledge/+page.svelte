<script lang="ts">
	import AudienceFields from '#lib/components/AudienceFields.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Field from '#lib/components/ui/Field.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const base = $derived(`/t/${data.tenant.slug}/knowledge`);
	const values = $derived((form && 'values' in form ? form.values : {}) as Record<string, string>);
	const link = (p: { folder?: string | null; grid?: boolean; q?: string | null }) => {
		const s = [p.folder && `folder=${p.folder}`, p.q && `q=${encodeURIComponent(p.q)}`, p.grid && 'view=grid'].filter(
			Boolean
		);
		return s.length ? `${base}?${s.join('&')}` : base;
	};
	const here = $derived({ folder: data.current?.id, q: data.query });
	const WHO: Record<string, string> = { all: 'Everyone', department: 'Department', branch: 'Branch' };
	const who = (f: { audience: string; target: string | null }) =>
		f.audience === 'all' ? WHO.all : `${WHO[f.audience]}: ${f.target ?? '—'}`;
</script>

<svelte:head><title>Knowledge base · {data.tenant.name}</title></svelte:head>

<h1 class="page-title">Knowledge base</h1>

<form
	method="GET"
	action={base}
	class="mt-4 flex max-w-3xl flex-wrap gap-2"
	role="search"
	aria-label="Knowledge base search"
>
	{#if data.grid}<input type="hidden" name="view" value="grid" />{/if}
	<label class="min-w-0 flex-1">
		<span class="sr-only">Search articles and policies</span>
		<input
			name="q"
			type="search"
			value={data.query ?? ''}
			placeholder="Search articles and policies"
			maxlength="80"
			class="block w-full input"
		/>
	</label>
	<Button type="submit" variant="secondary">Search</Button>
</form>

<div class="mt-4 max-w-3xl space-y-2">
	<Alert message={form?.message} />
	{#if data.badQuery}<Alert tone="info" message="Type at least 2 characters to search." />{/if}
</div>

<nav class="mt-4 flex max-w-3xl flex-wrap items-center gap-1 text-sm" aria-label="Folder path">
	<a href={link({ grid: data.grid })} class="text-brand-700 hover:underline">Knowledge base</a>
	{#each data.trail as f (f.id)}
		<span class="text-slate-400">/</span>
		<a
			href={link({ folder: f.id, grid: data.grid })}
			aria-current={f.id === data.current?.id ? 'page' : undefined}
			class="break-words text-brand-700 hover:underline"
		>
			{f.name}
		</a>
	{/each}
	{#if data.query}<span class="text-slate-500">· Results for “{data.query}”</span>{/if}
	<span class="ml-auto flex gap-2">
		<a href={link({ ...here })} aria-current={data.grid ? undefined : 'true'} class="text-slate-600 hover:underline">
			List
		</a>
		<a
			href={link({ ...here, grid: true })}
			aria-current={data.grid ? 'true' : undefined}
			class="text-slate-600 hover:underline"
		>
			Grid
		</a>
	</span>
</nav>

{#if data.current && data.manager}
	<p class="mt-1 text-xs text-slate-500">Open to: {who(data.current)}</p>
{/if}

{#if data.children.length}
	<section class="mt-4 max-w-3xl" aria-label="Folders">
		<h2 class="section-title">Folders</h2>
		<ul class="mt-2 grid gap-2 sm:grid-cols-2">
			{#each data.children as f (f.id)}
				<li>
					<a
						href={link({ folder: f.id, grid: data.grid })}
						class="block rounded-lg px-3 py-2 ring-1 ring-slate-200 ring-inset hover:bg-slate-50"
						data-testid="kb-folder"
					>
						<span class="block font-medium break-words text-slate-800">{f.name}</span>
						{#if data.manager}<span class="text-xs text-slate-500">{who(f)}</span>{/if}
					</a>
				</li>
			{/each}
		</ul>
	</section>
{/if}

<section class="mt-4 max-w-3xl" aria-label="Articles">
	<h2 class="section-title">Articles</h2>
	{#if data.articles.length}
		<ul class={data.grid ? 'mt-2 grid gap-3 sm:grid-cols-2' : 'mt-2 divide-y divide-slate-100 panel text-sm'}>
			{#each data.articles as a (a.id)}
				<li class={data.grid ? 'panel' : 'py-2'} data-testid="kb-article">
					<a href={`${base}/${a.id}`} class="font-medium break-words text-brand-700 hover:underline">{a.title}</a>
					{#if a.status === 'draft'}<span class="ml-1 text-xs text-amber-700">Draft</span>{/if}
					{#if data.query && a.folder}<span class="block text-xs text-slate-500">In {a.folder}</span>{/if}
					{#if data.grid && a.excerpt}<p class="mt-1 text-sm break-words text-slate-600">{a.excerpt}</p>{/if}
				</li>
			{/each}
		</ul>
		{#if data.more}
			<p class="mt-2 text-xs text-slate-500">Showing the first 50 matches. Search for something narrower.</p>
		{/if}
	{:else}
		<p class="mt-2 text-sm text-slate-600">{data.query ? 'No articles match.' : 'No articles here yet.'}</p>
	{/if}
</section>

{#if !data.current || data.query}
	<section class="mt-4 max-w-3xl" aria-label="Policies">
		<div class="flex flex-wrap items-center justify-between gap-2">
			<h2 class="section-title">Policies</h2>
			<a href={`/t/${data.tenant.slug}/policies`} class="text-sm text-brand-700 hover:underline">Open Policies</a>
		</div>
		{#if data.policies.length}
			<ul class={data.grid ? 'mt-2 grid gap-3 sm:grid-cols-2' : 'mt-2 divide-y divide-slate-100 panel text-sm'}>
				{#each data.policies as p (p.id)}
					<li class={data.grid ? 'panel' : 'py-2'} data-testid="kb-policy">
						<a
							href={`/t/${data.tenant.slug}/policies/${p.id}/file`}
							class="font-medium break-words text-brand-700 hover:underline"
							data-sveltekit-reload
						>
							{p.title}
						</a>
						{#if p.description}<p class="mt-1 text-sm break-words text-slate-600">{p.description}</p>{/if}
					</li>
				{/each}
			</ul>
		{:else}
			<p class="mt-2 text-sm text-slate-600">{data.query ? 'No policies match.' : 'No policies yet.'}</p>
		{/if}
	</section>
{/if}

{#if data.admin && !data.query}
	<section class="mt-6 max-w-3xl panel" aria-label="New article">
		<h2 class="section-title">New article {data.current ? `in ${data.current.name}` : 'at the top level'}</h2>
		<form method="POST" action="?/article" class="mt-3 grid gap-3">
			<input type="hidden" name="folderId" value={data.current?.id ?? ''} />
			<Field label="Title" name="title" required maxlength={160} value={values.title ?? ''} />
			<div><Button type="submit">Create draft</Button></div>
		</form>
	</section>

	{#if data.admin.full}
		<p class="mt-4 text-sm text-slate-600">The knowledge base has reached its folder limit.</p>
	{:else if data.trail.length < 4}
		<section class="mt-4 max-w-3xl panel" aria-label="New folder">
			<h2 class="section-title">New folder {data.current ? `in ${data.current.name}` : 'at the top level'}</h2>
			<form method="POST" action="?/folder" class="mt-3 grid gap-3 sm:grid-cols-2">
				<input type="hidden" name="parentId" value={data.current?.id ?? ''} />
				<Field label="Folder name" name="name" required maxlength={80} />
				<AudienceFields label="Who can open it" departments={data.admin.departments} branches={data.admin.branches} />
				<div><Button type="submit">Add folder</Button></div>
			</form>
			<p class="mt-2 text-xs text-slate-500">
				A folder inside a restricted folder is only open to people who can open both.
			</p>
		</section>
	{/if}

	{#if data.current}
		<section class="mt-4 max-w-3xl panel" aria-label="Folder settings">
			<h2 class="section-title">Folder settings</h2>
			<form method="POST" action="?/folder" class="mt-3 grid gap-3 sm:grid-cols-2">
				<input type="hidden" name="folderId" value={data.current.id} />
				<Field label="Folder name" name="name" required maxlength={80} value={data.current.name} />
				{#key data.current.id}
					<AudienceFields
						label="Who can open it"
						audience={data.current.audience}
						departmentId={data.current.departmentId ?? ''}
						branchId={data.current.branchId ?? ''}
						departments={data.admin.departments}
						branches={data.admin.branches}
					/>
				{/key}
				<div><Button type="submit">Save folder</Button></div>
			</form>
			<form method="POST" action="?/removeFolder" class="mt-3">
				<input type="hidden" name="folderId" value={data.current.id} />
				<Button type="submit" variant="secondary">Delete empty folder</Button>
			</form>
		</section>
	{/if}
{/if}
