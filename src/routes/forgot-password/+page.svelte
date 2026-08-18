<script lang="ts">
	import type { ActionData } from './$types';
	let { form }: { form: ActionData } = $props();
</script>

<h1>Forgot password</h1>

{#if form?.sent}
	<p>If that email is registered, a reset link has been sent.</p>
{:else}
	<form method="POST">
		<label>Email <input name="email" type="email" required /></label>
		<button type="submit">Send reset link</button>
	</form>
{/if}

<a href="/login">Back to login</a>
