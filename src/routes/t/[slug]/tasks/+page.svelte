<script lang="ts">
	import TaskList from '#lib/components/TaskList.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const b = $derived(data.board);
	const input = 'input px-2 py-1';
	const values = $derived((form && 'values' in form && form.values) || {});
	const late = (t: { dueOn: string | null; status: string }) => t.status === 'open' && !!t.dueOn && t.dueOn < b.today;
</script>

<svelte:head><title>Tasks · {data.tenant.name}</title></svelte:head>

{#snippet task(t: (typeof b.mine)[number], who: boolean)}
	<li class="py-3" data-testid="task">
		<p class={t.status === 'done' ? 'text-slate-400 line-through' : 'font-medium text-slate-800'}>{t.title}</p>
		<p class="text-xs text-slate-500">
			{who ? `${t.assignee} · ` : ''}{t.dueOn ? `due ${t.dueOn}` : 'no due date'}{#if late(t)}<span
					class="text-red-700"
				>
					· late
				</span>{/if}
		</p>
		{#if t.description}<p class="mt-1 whitespace-pre-line text-slate-600">{t.description}</p>{/if}
		<div class="mt-2 flex flex-wrap gap-2">
			<form method="POST" action="?/status">
				<input type="hidden" name="taskId" value={t.id} />
				<input type="hidden" name="done" value={t.status === 'open' ? 'true' : 'false'} />
				<Button type="submit">{t.status === 'open' ? `Mark ${t.title} done` : `Reopen ${t.title}`}</Button>
			</form>
			{#if t.createdByUserId === data.user.id}
				<form method="POST" action="?/remove">
					<input type="hidden" name="taskId" value={t.id} />
					<Button type="submit">Delete {t.title}</Button>
				</form>
			{/if}
		</div>
	</li>
{/snippet}

<h1 class="page-title">My tasks</h1>
<p class="mt-1 text-sm text-slate-600">
	Onboarding and offboarding tasks for your role, your team or yourself, and tasks people gave you.
</p>
<div class="mt-4 max-w-3xl space-y-2">
	<Alert message={form?.message} />
	{#if form && 'taskSaved' in form}<Alert tone="info" message="Task done." />{/if}
	{#if form && 'done' in form}<Alert tone="info" message={form.done} />{/if}
</div>
<section class="mt-4 max-w-3xl panel" aria-label="Open tasks">
	<TaskList
		tasks={data.tasks}
		slug={data.tenant.slug}
		roleNames={data.roleNames}
		action="?/task"
		files={data.taskFiles}
		{form}
	/>
</section>

<section class="mt-6 max-w-3xl panel" aria-label="Given to me">
	<h2 class="section-title">Given to me</h2>
	{#if b.mine.length}
		<ul class="mt-2 divide-y divide-slate-100 text-sm">
			{#each b.mine as t (t.id)}{@render task(t, false)}{/each}
		</ul>
	{:else}
		<p class="mt-2 text-sm text-slate-600">No tasks.</p>
	{/if}
</section>

{#if b.given.length}
	<section class="mt-6 max-w-3xl panel" aria-label="Given by me">
		<h2 class="section-title">Given by me</h2>
		<ul class="mt-2 divide-y divide-slate-100 text-sm">
			{#each b.given as t (t.id)}{@render task(t, true)}{/each}
		</ul>
	</section>
{/if}

{#if b.people.length}
	<section class="mt-6 max-w-3xl panel" aria-label="New task">
		<h2 class="section-title">New task</h2>
		<form method="POST" action="?/create" class="mt-3 grid gap-3 text-sm sm:grid-cols-2">
			<label class="block text-slate-700 sm:col-span-2">
				Title
				<input name="title" required maxlength="200" value={values.title ?? ''} class={`${input} block w-full`} />
			</label>
			<label class="block text-slate-700">
				For
				<select name="assigneeEmployeeId" required class={`${input} block w-full`}>
					{#each b.people as p (p.id)}
						<option value={p.id} selected={(values.assigneeEmployeeId ?? b.me) === p.id}>
							{p.id === b.me ? `${p.name} (me)` : p.name}
						</option>
					{/each}
				</select>
			</label>
			<label class="block text-slate-700">
				Due (optional)
				<input name="dueOn" type="date" min={b.today} value={values.dueOn ?? ''} class={`${input} block w-full`} />
			</label>
			<label class="block text-slate-700 sm:col-span-2">
				Details (optional)
				<textarea name="description" maxlength="2000" rows="3" class={`${input} block w-full`}
					>{values.description ?? ''}</textarea
				>
			</label>
			<div class="sm:col-span-2"><Button type="submit">Add task</Button></div>
		</form>
	</section>
{/if}
