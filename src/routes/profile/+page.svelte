<script lang="ts">
	import { enhance } from '$app/forms';

	let { data, form } = $props();

	const memberSince = $derived(
		data.account?.createdAt
			? new Date(data.account.createdAt).toLocaleDateString(undefined, {
					year: 'numeric',
					month: 'long',
					day: 'numeric'
				})
			: ''
	);

	const input =
		'rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-base outline-none focus:border-sky-500';
</script>

<h1 class="mb-5 text-2xl font-bold">You</h1>

<div class="mb-6 rounded-2xl border border-slate-800 bg-slate-900 p-4">
	<p class="text-lg font-semibold">{data.account?.name}</p>
	<p class="mt-1 text-xs text-slate-500">Member since {memberSince}</p>
	<p class="mt-2 text-sm text-slate-300">
		🧳 <span class="font-semibold text-white">{data.tripCount}</span>
		{data.tripCount === 1 ? 'trip' : 'trips'} joined
	</p>
</div>

<!-- Change name -->
<form method="POST" action="?/updateName" use:enhance class="mb-6 flex flex-col gap-3">
	<h2 class="text-sm font-bold uppercase tracking-wide text-slate-400">Name</h2>
	{#if form?.nameError}
		<p class="rounded-lg bg-red-950 px-3 py-2 text-sm text-red-300">{form.nameError}</p>
	{/if}
	<input name="name" value={data.account?.name ?? ''} required class={input} />
	<button type="submit" class="rounded-xl bg-sky-600 py-3 font-semibold text-white active:bg-sky-700">
		{form?.nameUpdated ? '✓ Saved' : 'Save name'}
	</button>
</form>

<!-- Change password -->
<form method="POST" action="?/updatePassword" use:enhance class="mb-6 flex flex-col gap-3">
	<h2 class="text-sm font-bold uppercase tracking-wide text-slate-400">Password</h2>
	{#if form?.pwError}
		<p class="rounded-lg bg-red-950 px-3 py-2 text-sm text-red-300">{form.pwError}</p>
	{/if}
	{#if form?.pwUpdated}
		<p class="rounded-lg bg-emerald-950 px-3 py-2 text-sm text-emerald-300">Password updated.</p>
	{/if}
	<input
		name="currentPassword"
		type="password"
		autocomplete="current-password"
		placeholder="Current password"
		required
		class={input}
	/>
	<input
		name="newPassword"
		type="password"
		autocomplete="new-password"
		placeholder="New password (min 8 characters)"
		required
		class={input}
	/>
	<button type="submit" class="rounded-xl bg-sky-600 py-3 font-semibold text-white active:bg-sky-700">
		Update password
	</button>
</form>

<form method="POST" action="/logout">
	<button
		type="submit"
		class="w-full rounded-xl border border-red-900 bg-red-950/50 py-3 font-semibold text-red-300 active:bg-red-950"
	>
		Log out
	</button>
</form>
