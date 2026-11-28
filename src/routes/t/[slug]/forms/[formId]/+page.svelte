<script lang="ts">
	import Alert from '#lib/components/ui/Alert.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const f = $derived(data.form);
	const input = 'input px-2 py-1';
	const draft = $derived(data.manage && f.status === 'draft');
	let kind = $state('text');
	let audience = $state('all');
	let schedule = $state('once');
	const KIND: Record<string, string> = {
		text: 'Text',
		number: 'Number',
		date: 'Date',
		select: 'One choice',
		multi: 'Several choices',
		checkbox: 'Yes / no',
		photo: 'Photo',
		file: 'File',
		acknowledge: 'Read and confirm'
	};
	const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
	const STATUS: Record<string, string> = { draft: 'Draft', published: 'Published', archived: 'Archived' };
	const every = (a: { schedule: string; weekday: number | null }) =>
		a.schedule === 'weekly' ? `Every ${DAYS[a.weekday ?? 0]}` : a.schedule === 'daily' ? 'Every day' : 'Once';
	const shown = (v: unknown) =>
		v === null || v === undefined || v === ''
			? '—'
			: Array.isArray(v)
				? v.join(', ')
				: v === true
					? 'Yes'
					: v === false
						? 'No'
						: String(v);
</script>

<svelte:head><title>{f.title} · {data.tenant.name}</title></svelte:head>

<h1 class="page-title">{f.title}</h1>
<p class="mt-1 text-sm text-slate-600" data-testid="form-status">{STATUS[f.status]} · {f.fields.length} question(s)</p>
{#if f.description}<p class="mt-1 max-w-3xl whitespace-pre-line text-sm text-slate-600">{f.description}</p>{/if}

<div class="mt-4 max-w-3xl space-y-2">
	<Alert message={form?.message} />
	{#if form && 'done' in form}<Alert tone="info" message={form.done} />{/if}
</div>

{#if data.manage}
	<section class="mt-6 max-w-3xl panel" aria-label="Questions">
		<h2 class="section-title">Questions</h2>
		{#if f.fields.length}
			<ol class="mt-2 list-decimal space-y-2 pl-5 text-sm">
				{#each f.fields as q (q.id)}
					<li data-testid="question">
						<span class="font-medium text-slate-800">{q.label}</span>
						<span class="text-slate-500">
							· {KIND[q.kind]}{q.required ? ' · required' : ''}{q.options.length ? ` · ${q.options.join(', ')}` : ''}
						</span>
						{#if draft}
							<form method="POST" action="?/removeField" class="inline">
								<input type="hidden" name="fieldId" value={q.id} />
								<Button type="submit">Remove {q.label}</Button>
							</form>
						{/if}
					</li>
				{/each}
			</ol>
		{:else}
			<p class="mt-2 text-sm text-slate-600">No questions yet.</p>
		{/if}
		{#if draft}
			<form method="POST" action="?/field" class="mt-3 grid gap-2 text-sm sm:grid-cols-2">
				<label class="block text-slate-700 sm:col-span-2">
					Question
					<input name="label" required maxlength="200" class={`${input} block w-full`} />
				</label>
				<label class="block text-slate-700">
					Answer
					<select name="kind" bind:value={kind} class={`${input} block w-full`}>
						{#each Object.entries(KIND) as [k, label] (k)}<option value={k}>{label}</option>{/each}
					</select>
				</label>
				<label class="flex items-center gap-2 self-end text-slate-700">
					<input type="checkbox" name="required" /> Required
				</label>
				{#if kind === 'select' || kind === 'multi'}
					<label class="block text-slate-700 sm:col-span-2">
						Choices, one per line
						<textarea name="options" rows="3" required class={`${input} block w-full`}></textarea>
					</label>
				{/if}
				<div class="sm:col-span-2"><Button type="submit">Add question</Button></div>
			</form>
			<div class="mt-4 flex flex-wrap gap-2">
				<form method="POST" action="?/publish"><Button type="submit">Publish form</Button></form>
				<form method="POST" action="?/remove"><Button type="submit">Delete draft</Button></form>
			</div>
			<p class="mt-2 text-xs text-slate-500">Questions are fixed once the form is published.</p>
		{:else if f.status === 'published'}
			<form method="POST" action="?/archive" class="mt-3"><Button type="submit">Archive form</Button></form>
		{/if}
	</section>

	{#if f.status !== 'draft'}
		<section class="mt-6 max-w-3xl panel" aria-label="Assignments">
			<h2 class="section-title">Assignments</h2>
			{#if data.assignments.length}
				<ul class="mt-2 divide-y divide-slate-100 text-sm">
					{#each data.assignments as a (a.id)}
						<li class="flex flex-wrap items-center justify-between gap-2 py-2" data-testid="assignment">
							<span>
								{a.target} · {every(a)} · from {a.startsOn}{a.endsOn ? ` to ${a.endsOn}` : ''} · reminder {String(
									a.remindHour
								).padStart(2, '0')}:00
							</span>
							{#if !a.endsOn || a.endsOn > data.today}
								<form method="POST" action="?/endAssignment">
									<input type="hidden" name="assignmentId" value={a.id} />
									<Button type="submit">End assignment for {a.target}</Button>
								</form>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
			{#if f.status === 'published'}
				<form method="POST" action="?/assign" class="mt-3 grid gap-2 text-sm sm:grid-cols-2">
					<label class="block text-slate-700">
						Who
						<select name="audience" bind:value={audience} class={`${input} block w-full`}>
							<option value="all">Everyone</option>
							<option value="department">A department</option>
							<option value="branch">A branch</option>
							<option value="employee">One person</option>
						</select>
					</label>
					{#if audience === 'department'}
						<label class="block text-slate-700">
							Department
							<select name="departmentId" required class={`${input} block w-full`}>
								{#each data.departments as d (d.id)}<option value={d.id}>{d.name}</option>{/each}
							</select>
						</label>
					{:else if audience === 'branch'}
						<label class="block text-slate-700">
							Branch
							<select name="branchId" required class={`${input} block w-full`}>
								{#each data.branches as b (b.id)}<option value={b.id}>{b.name}</option>{/each}
							</select>
						</label>
					{:else if audience === 'employee'}
						<label class="block text-slate-700">
							Person
							<select name="employeeId" required class={`${input} block w-full`}>
								{#each data.people as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
							</select>
						</label>
					{/if}
					<label class="block text-slate-700">
						How often
						<select name="schedule" bind:value={schedule} class={`${input} block w-full`}>
							<option value="once">Once</option>
							<option value="daily">Every day</option>
							<option value="weekly">Every week</option>
						</select>
					</label>
					{#if schedule === 'weekly'}
						<label class="block text-slate-700">
							Day
							<select name="weekday" class={`${input} block w-full`}>
								{#each DAYS as d, i (d)}<option value={i}>{d}</option>{/each}
							</select>
						</label>
					{/if}
					<label class="block text-slate-700">
						Reminder hour
						<select name="remindHour" class={`${input} block w-full`}>
							{#each { length: 24 } as _, h (h)}
								<option value={h} selected={h === 9}>{String(h).padStart(2, '0')}:00</option>
							{/each}
						</select>
					</label>
					<label class="block text-slate-700">
						Starts on
						<input name="startsOn" type="date" required min={data.today} class={`${input} block w-full`} />
					</label>
					<label class="block text-slate-700">
						Ends on (optional)
						<input name="endsOn" type="date" min={data.today} class={`${input} block w-full`} />
					</label>
					<div class="sm:col-span-2"><Button type="submit">Assign form</Button></div>
				</form>
			{/if}
		</section>
	{/if}
{/if}

{#if f.status !== 'draft'}
	<section class="mt-6 max-w-4xl panel" aria-label="Submissions">
		<h2 class="section-title">Submissions</h2>
		<p class="mt-1 text-xs text-slate-500">The latest 200 you may see.</p>
		{#if data.submissions.length}
			<ul class="mt-2 divide-y divide-slate-100 text-sm">
				{#each data.submissions as s (s.id)}
					<li class="py-3" data-testid="submission">
						<p class="font-medium text-slate-800">
							{s.name} <span class="font-normal text-slate-400">· {s.period}</span>
						</p>
						<dl class="mt-1 grid gap-x-4 gap-y-1 sm:grid-cols-2">
							{#each f.fields as q (q.id)}
								<div class="min-w-0">
									<dt class="text-xs text-slate-500">{q.label}</dt>
									<dd class="break-words text-slate-700">
										{#if q.kind === 'photo' || q.kind === 'file'}
											{@const file = s.files.find((x) => x.id === s.answers[q.id])}
											{#if file}
												<a href={`/t/${data.tenant.slug}/files/${file.id}`} class="text-brand-700 hover:underline">
													{file.filename}
												</a>
											{:else}—{/if}
										{:else}
											{shown(s.answers[q.id])}
										{/if}
									</dd>
								</div>
							{/each}
						</dl>
						{#if s.lat !== null}<p class="mt-1 text-xs text-slate-500">Location {s.lat}, {s.lng}</p>{/if}
					</li>
				{/each}
			</ul>
		{:else}
			<p class="mt-2 text-sm text-slate-600">No submissions yet.</p>
		{/if}
	</section>
{/if}
