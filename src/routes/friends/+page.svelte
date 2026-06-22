<script lang="ts">
	import { enhance } from '$app/forms';
	let { data } = $props();
</script>

<h1 class="mb-5 text-2xl font-bold">Friends</h1>

{#if data.incoming.length}
	<section class="mb-6">
		<h2 class="mb-2 text-sm font-bold uppercase tracking-wide text-slate-400">Requests</h2>
		<ul class="flex flex-col gap-2">
			{#each data.incoming as r (r.id)}
				<li class="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-900 p-3">
					<span class="font-semibold">{r.name}</span>
					<form method="POST" action="?/accept" use:enhance>
						<input type="hidden" name="id" value={r.id} />
						<button type="submit" class="rounded-full bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white">Accept</button>
					</form>
				</li>
			{/each}
		</ul>
	</section>
{/if}

<section>
	<h2 class="mb-2 text-sm font-bold uppercase tracking-wide text-slate-400">Your friends</h2>
	{#if data.friends.length === 0}
		<p class="text-slate-400">No friends yet. Add people from a trip’s People tab.</p>
	{:else}
		<ul class="flex flex-col gap-2">
			{#each data.friends as f (f.name)}
				<li class="rounded-2xl border border-slate-800 bg-slate-900 p-3 font-semibold">{f.name}</li>
			{/each}
		</ul>
	{/if}
</section>

{#if data.outgoing.length}
	<p class="mt-4 text-xs text-slate-500">
		Pending sent: {data.outgoing.map((o) => o.name).join(', ')}
	</p>
{/if}
