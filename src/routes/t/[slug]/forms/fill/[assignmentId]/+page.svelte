<script lang="ts">
	import Alert from '#lib/components/ui/Alert.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const f = $derived(data.fill);
	const input = 'input px-2 py-1';
	let lat = $state('');
	let lng = $state('');
	let locating = $state('');
	const locate = () => {
		locating = 'Finding your location…';
		navigator.geolocation?.getCurrentPosition(
			(p) => {
				lat = p.coords.latitude.toFixed(6);
				lng = p.coords.longitude.toFixed(6);
				locating = 'Location added.';
			},
			() => (locating = 'Location not available.')
		);
	};
</script>

<svelte:head><title>{f.title} · {data.tenant.name}</title></svelte:head>

<h1 class="page-title">{f.title}</h1>
<p class="mt-1 text-sm text-slate-600">For {f.schedule === 'once' ? 'this assignment' : f.period}</p>
{#if f.description}<p class="mt-2 max-w-3xl whitespace-pre-line text-sm text-slate-600">{f.description}</p>{/if}
<div class="mt-4 max-w-3xl"><Alert message={form?.message} /></div>

{#if f.submitted}
	<p class="mt-4 text-sm text-slate-600">You already sent this form for this period.</p>
{:else}
	<form method="POST" action="?/submit" enctype="multipart/form-data" class="mt-4 max-w-3xl space-y-4 text-sm panel">
		{#each f.fields as q (q.id)}
			{#if q.kind === 'select'}
				<label class="block text-slate-700">
					{q.label}{q.required ? ' *' : ''}
					<select name={q.id} required={q.required} class={`${input} block w-full`}>
						<option value="">Choose…</option>
						{#each q.options as o (o)}<option value={o}>{o}</option>{/each}
					</select>
				</label>
			{:else if q.kind === 'multi'}
				<fieldset>
					<legend class="text-slate-700">{q.label}{q.required ? ' *' : ''}</legend>
					{#each q.options as o (o)}
						<label class="mr-4 inline-flex items-center gap-1 text-slate-700">
							<input type="checkbox" name={q.id} value={o} />
							{o}
						</label>
					{/each}
				</fieldset>
			{:else if q.kind === 'checkbox'}
				<fieldset>
					<legend class="text-slate-700">{q.label}{q.required ? ' *' : ''}</legend>
					{#each [['yes', 'Yes'], ['no', 'No']] as [value, label] (value)}
						<label class="mr-4 inline-flex items-center gap-1 text-slate-700">
							<input type="radio" name={q.id} {value} required={q.required} />
							{label}
						</label>
					{/each}
				</fieldset>
			{:else if q.kind === 'acknowledge'}
				<label class="flex items-start gap-2 text-slate-700">
					<input type="checkbox" name={q.id} required class="mt-1" />
					<span>{q.label} (I have read and confirm)</span>
				</label>
			{:else if q.kind === 'photo' || q.kind === 'file'}
				<label class="block text-slate-700">
					{q.label}{q.required ? ' *' : ''}
					<input
						type="file"
						name={q.id}
						required={q.required}
						accept={q.kind === 'photo'
							? 'image/png,image/jpeg,image/webp'
							: 'application/pdf,image/png,image/jpeg,image/webp'}
						capture={q.kind === 'photo' ? 'environment' : undefined}
						class="block w-full text-xs"
					/>
				</label>
			{:else}
				<label class="block text-slate-700">
					{q.label}{q.required ? ' *' : ''}
					{#if q.kind === 'text'}
						<textarea name={q.id} required={q.required} maxlength="2000" rows="2" class={`${input} block w-full`}
						></textarea>
					{:else}
						<input
							name={q.id}
							type={q.kind === 'date' ? 'date' : 'text'}
							inputmode={q.kind === 'number' ? 'decimal' : undefined}
							pattern={q.kind === 'number' ? '-?\\d{1,10}(\\.\\d{1,4})?' : undefined}
							required={q.required}
							class={`${input} block w-full`}
						/>
					{/if}
				</label>
			{/if}
		{/each}
		<input type="hidden" name="lat" value={lat} />
		<input type="hidden" name="lng" value={lng} />
		<div class="flex flex-wrap items-center gap-2">
			<Button type="button" onclick={locate}>Add my location</Button>
			{#if locating}<span class="text-xs text-slate-500" role="status">{locating}</span>{/if}
		</div>
		<p class="text-xs text-slate-500">Photos and files: PDF or image, 10 MB in total.</p>
		<Button type="submit">Send form</Button>
	</form>
{/if}
