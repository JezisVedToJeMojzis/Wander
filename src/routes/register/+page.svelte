<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';

	let { form } = $props();
	const next = $derived(page.url.searchParams.get('next'));
	const loginHref = $derived(next ? `/login?next=${encodeURIComponent(next)}` : '/login');
</script>

<div class="flex flex-col gap-6 pt-10">
	<div class="text-center">
		<h1 class="text-3xl font-bold">Create account</h1>
		<p class="mt-1 text-slate-400">Start planning your next trip.</p>
	</div>

	<form method="POST" use:enhance class="flex flex-col gap-3">
		{#if form?.error}
			<p class="rounded-lg bg-red-950 px-3 py-2 text-sm text-red-300">{form.error}</p>
		{/if}
		<input
			name="name"
			type="text"
			autocomplete="name"
			placeholder="Your name"
			value={form?.name ?? ''}
			required
			class="rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-base outline-none focus:border-sky-500"
		/>
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
			autocomplete="new-password"
			placeholder="Password (min 8 characters)"
			required
			class="rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-base outline-none focus:border-sky-500"
		/>
		<button
			type="submit"
			class="mt-1 rounded-xl bg-sky-600 px-4 py-3 text-base font-semibold text-white active:bg-sky-700"
		>
			Sign up
		</button>
	</form>

	<p class="text-center text-sm text-slate-400">
		Already have an account? <a href={loginHref} class="font-semibold text-sky-400">Log in</a>
	</p>
</div>
