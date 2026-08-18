<script lang="ts">
	import type { ActionData } from './$types';
	let { form }: { form: ActionData } = $props();
</script>

<form method="POST">
	<h1>HRMS Pro — Login</h1>
	{#if form?.message}<p class="error">{form.message}</p>{/if}
	<label>Email <input name="email" type="email" required /></label>
	<label>Password <input name="password" type="password" required /></label>
	<button type="submit">Log in</button>
</form>
