<script lang="ts">
	import Markdown from '#lib/components/Markdown.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Field from '#lib/components/ui/Field.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const base = $derived(`/t/${data.tenant.slug}/knowledge`);
	const a = $derived(data.article);
	const values = $derived((form && 'values' in form ? form.values : {}) as Record<string, string>);
	const v = $derived({
		title: values.title ?? a.title,
		folderId: values.folderId ?? a.folderId ?? '',
		bodyMd: values.bodyMd ?? a.bodyMd,
		status: values.status ?? a.status
	});
	const input = 'mt-1 block w-full input';
</script>

<svelte:head><title>{a.title} · {data.tenant.name}</title></svelte:head>

<nav class="flex flex-wrap items-center gap-1 text-sm" aria-label="Folder path">
	<a href={base} class="text-brand-700 hover:underline">Knowledge base</a>
	{#each data.trail as f (f.id)}
		<span class="text-slate-400">/</span>
		<a href={`${base}?folder=${f.id}`} class="break-words text-brand-700 hover:underline">{f.name}</a>
	{/each}
</nav>

<h1 class="mt-2 page-title break-words">{a.title}</h1>
<p class="mt-1 text-xs text-slate-500">
	Updated {a.updatedAt.toISOString().slice(0, 10)}{a.status === 'draft'
		? ' · Draft, only knowledge base managers see it'
		: ''}
</p>

<div class="mt-4 max-w-3xl"><Alert message={form?.message} /></div>

{#if data.editing || form?.message}
	<section class="mt-4 max-w-3xl panel" aria-label="Edit article">
		<h2 class="section-title">Edit article</h2>
		<form method="POST" action="?/save" class="mt-3 grid gap-3">
			<Field label="Title" name="title" required maxlength={160} value={v.title} />
			<label class="block text-sm font-medium text-slate-700">
				Folder
				<select name="folderId" class={input}>
					<option value="" selected={!v.folderId}>Top level</option>
					{#each data.folders as f (f.id)}<option value={f.id} selected={v.folderId === f.id}>{f.path}</option>{/each}
				</select>
			</label>
			<label class="block text-sm font-medium text-slate-700">
				Article
				<textarea name="bodyMd" rows="14" maxlength={50000} class={input}>{v.bodyMd}</textarea>
				<span class="mt-1 block text-xs font-normal text-slate-500">
					Markdown: # heading, **bold**, *italic*, - list, 1. list and [text](https://link).
				</span>
			</label>
			<label class="block text-sm font-medium text-slate-700">
				Status
				<select name="status" class={input}>
					<option value="draft" selected={v.status === 'draft'}>Draft</option>
					<option value="published" selected={v.status === 'published'}>Published</option>
				</select>
			</label>
			<div class="flex flex-wrap gap-2">
				<Button type="submit">Save article</Button>
				<a href={`${base}/${a.id}`} class="self-center text-sm text-slate-600 hover:underline">Cancel</a>
			</div>
		</form>
		<form method="POST" action="?/remove" class="mt-4">
			<Button type="submit" variant="danger">Delete article</Button>
		</form>
	</section>
{:else}
	<article class="mt-4 max-w-3xl panel">
		{#if a.bodyMd.trim()}
			<Markdown source={a.bodyMd} class="text-sm text-slate-800" />
		{:else}
			<p class="text-sm text-slate-600">This article is empty.</p>
		{/if}
	</article>
	{#if data.manager}
		<a href={`${base}/${a.id}?edit=1`} class="mt-3 inline-block text-sm font-medium text-brand-700 hover:underline">
			Edit article
		</a>
	{/if}
{/if}
