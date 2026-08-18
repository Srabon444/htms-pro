<script lang="ts">
	import { supabase } from '$lib/supabaseClient';
	import { goto } from '$app/navigation';

	let password = $state('');
	let error = $state<string | null>(null);
	let done = $state(false);

	async function updatePassword(e: SubmitEvent) {
		e.preventDefault();
		error = null;

		const { error: updateError } = await supabase.auth.updateUser({ password });
		if (updateError) {
			error = updateError.message;
			return;
		}

		done = true;
		setTimeout(() => goto('/'), 1500);
	}
</script>

<h1>Reset password</h1>

{#if done}
	<p>Password updated. Redirecting...</p>
{:else}
	<form onsubmit={updatePassword}>
		<label>New password <input type="password" bind:value={password} required minlength="8" /></label>
		{#if error}<p class="error">{error}</p>{/if}
		<button type="submit">Update password</button>
	</form>
{/if}
