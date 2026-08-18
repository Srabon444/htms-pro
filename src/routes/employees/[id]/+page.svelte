<script lang="ts">
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();

	//* untyped supabase client infers embedded *-to-one as an array; cast to the real runtime shape
	let department = $derived(
		(data.employee.hrms_departments as unknown as { name: string } | null)?.name ?? 'Unassigned'
	);
	let position = $derived(
		(data.employee.hrms_positions as unknown as { title: string } | null)?.title ?? 'Unassigned'
	);
</script>

<h1>{data.employee.full_name}</h1>
<p>{department} / {position}</p>
<p>Joined: {data.employee.join_date}</p>

<form method="POST" action="?/updateStatus">
	<select name="status">
		<option value="active" selected={data.employee.status === 'active'}>Active</option>
		<option value="resigned" selected={data.employee.status === 'resigned'}>Resigned</option>
		<option value="terminated" selected={data.employee.status === 'terminated'}>Terminated</option
		>
	</select>
	<button type="submit">Update status</button>
</form>

<h2>Documents</h2>
<form method="POST" action="?/uploadDocument" enctype="multipart/form-data">
	<input name="label" placeholder="Document label" required />
	<input name="file" type="file" required />
	<button type="submit">Upload</button>
</form>
<ul>
	{#each data.documents as doc}
		<li>{doc.label} — {doc.file_path}</li>
	{/each}
</ul>
