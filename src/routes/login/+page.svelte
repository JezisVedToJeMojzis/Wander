<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';

	let { form } = $props();
	const next = $derived(page.url.searchParams.get('next'));
	const registerHref = $derived(next ? `/register?next=${encodeURIComponent(next)}` : '/register');
</script>

<div class="flex flex-col gap-6 pt-10">
	<div class="text-center">
		<h1 class="text-3xl font-bold">Wander</h1>
		<p class="mt-1 text-slate-400">Plan trips together.</p>
	</div>

	<form method="POST" use:enhance class="flex flex-col gap-3">
		{#if form?.error}
			<p class="rounded-lg bg-red-950 px-3 py-2 text-sm text-red-300">{form.error}</p>
		{/if}
		<input
			name="email"
			type="email"
			inputmode="email"
			autocomplete="email"
			placeholder="Email"
			value={form?.email ?? ''}
			required
			class="rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-base outline-none focus:border-sky-500"
		/>
		<input
			name="password"
			type="password"
			autocomplete="current-password"
			placeholder="Password"
			required
			class="rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-base outline-none focus:border-sky-500"
		/>
		<button
			type="submit"
			class="mt-1 rounded-xl bg-sky-600 px-4 py-3 text-base font-semibold text-white active:bg-sky-700"
		>
			Log in
		</button>
	</form>

	<p class="text-center text-sm text-slate-400">
		New here? <a href={registerHref} class="font-semibold text-sky-400">Create an account</a>
	</p>
</div>
