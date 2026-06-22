<script lang="ts">
	import { enhance } from '$app/forms';

	let { data, form } = $props();
	let showCreate = $state(false);

	function fmtDates(start: string | null, end: string | null) {
		if (!start && !end) return null;
		const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
		const s = start ? new Date(start).toLocaleDateString(undefined, opts) : '?';
		const e = end ? new Date(end).toLocaleDateString(undefined, opts) : '?';
		return start && end ? `${s} – ${e}` : s;
	}
</script>

<header class="mb-5 flex items-center justify-between">
	<h1 class="text-2xl font-bold">Your trips</h1>
	<button
		onclick={() => (showCreate = !showCreate)}
		class="rounded-full bg-sky-600 px-4 py-2 text-sm font-semibold text-white active:bg-sky-700"
	>
		{showCreate ? 'Close' : '+ New trip'}
	</button>
</header>

{#if showCreate}
	<form
		method="POST"
		action="?/create"
		use:enhance
		class="mb-6 flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-4"
	>
		{#if form?.error}
			<p class="rounded-lg bg-red-950 px-3 py-2 text-sm text-red-300">{form.error}</p>
		{/if}
		<input
			name="name"
			placeholder="Trip name (e.g. Berlin weekend)"
			required
			class="rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-base outline-none focus:border-sky-500"
		/>
		<input
			name="destination"
			placeholder="Destination (e.g. Berlin, Germany)"
			class="rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-base outline-none focus:border-sky-500"
		/>
		<div class="flex gap-3">
			<label class="flex flex-1 flex-col gap-1 text-xs text-slate-400">
				Start
				<input
					name="startDate"
					type="date"
					class="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2.5 text-base outline-none focus:border-sky-500"
				/>
			</label>
			<label class="flex flex-1 flex-col gap-1 text-xs text-slate-400">
				End
				<input
					name="endDate"
					type="date"
					class="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2.5 text-base outline-none focus:border-sky-500"
				/>
			</label>
		</div>
		<button
			type="submit"
			class="rounded-xl bg-sky-600 px-4 py-3 font-semibold text-white active:bg-sky-700"
		>
			Create trip
		</button>
	</form>
{/if}

{#if data.trips.length === 0}
	<div class="mt-16 text-center text-slate-400">
		<p class="text-5xl">🗺️</p>
		<p class="mt-3">No trips yet.</p>
		<p class="text-sm">Tap “New trip” to start planning.</p>
	</div>
{:else}
	<ul class="flex flex-col gap-3">
		{#each data.trips as trip (trip.id)}
			{@const dates = fmtDates(trip.startDate, trip.endDate)}
			<li>
				<a
					href={`/trips/${trip.id}`}
					class="block rounded-2xl border border-slate-800 bg-slate-900 p-4 active:bg-slate-800"
				>
					<div class="flex items-start justify-between gap-2">
						<h2 class="text-lg font-semibold">{trip.name}</h2>
						{#if trip.role === 'organizer'}
							<span class="rounded-full bg-sky-950 px-2 py-0.5 text-xs text-sky-300">organizer</span>
						{/if}
					</div>
					{#if trip.destination}
						<p class="text-sm text-slate-400">📍 {trip.destination}</p>
					{/if}
					<p class="mt-1 text-xs text-slate-500">
						{#if dates}{dates} · {/if}{trip.members} {trip.members === 1 ? 'person' : 'people'}
					</p>
				</a>
			</li>
		{/each}
	</ul>
{/if}
