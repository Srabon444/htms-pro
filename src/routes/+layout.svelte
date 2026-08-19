<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';
	import { invalidateAll } from '$app/navigation';
	import { supabase } from '$lib/supabaseClient';

	let { children } = $props();

	async function logout() {
		await supabase.auth.signOut();
		await invalidateAll();
	}
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<nav>
	<a href="/employees">Employees</a>
	<a href="/attendance">Attendance</a>
	<a href="/recruitment">Recruitment</a>
	<a href="/issues">Issues</a>
	<a href="/work-plan">Work Plan</a>
	<a href="/">Weekly Report</a>
	<button onclick={logout}>Log out</button>
</nav>

{@render children()}
