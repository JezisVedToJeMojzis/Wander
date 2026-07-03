<script lang="ts">
	import { enhance } from '$app/forms';
	import { googleMapsUrl } from '$lib/maps';

	let { data, form } = $props();

	type Tab = 'ideas' | 'plan' | 'route' | 'people';
	let tab = $state<Tab>('ideas');

	type Scope = 'mine' | 'shared';
	let routeScope = $state<Scope>('mine');
	const view = $derived(data.routeView[routeScope]);
	// Groups available to move a stop into, for the per-stop dropdown.
	const groupOptions = $derived(view.groups.map((g) => ({ id: g.id, name: g.name })));

	const fmtKm = (km: number) => (km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`);
	let showAdd = $state(false);
	let scheduleFor = $state<string | null>(null);
	let editFor = $state<string | null>(null);
	let copied = $state(false);
	let showAddGroup = $state(false);
	let showSettings = $state(false);
	let mineOnly = $state(false); // "All vs Mine" filter for Activities + Plan

	// "Mine" = activities I proposed or upvoted.
	const isMine = (a: { proposedByName: string; myVote: number }) =>
		a.proposedByName === 'You' || a.myVote === 1;
	const visiblePool = $derived(mineOnly ? data.pool.filter(isMine) : data.pool);
	const visibleScheduled = $derived(mineOnly ? data.scheduled.filter(isMine) : data.scheduled);

	const eur = (n: number) => `€${n.toLocaleString()}`;
	const planTotal = $derived(visibleScheduled.reduce((s, a) => s + (a.estCost ?? 0), 0));

	const categories = [
		{ value: 'food', label: '🍽️ Food' },
		{ value: 'sightseeing', label: '🏛️ Sightseeing' },
		{ value: 'museum', label: '🖼️ Museum' },
		{ value: 'culture', label: '🎭 Culture' },
		{ value: 'streetart', label: '🎨 Street art' },
		{ value: 'nightlife', label: '🌃 Nightlife' },
		{ value: 'outdoors', label: '🥾 Outdoors' },
		{ value: 'sport', label: '⚽ Sport' },
		{ value: 'other', label: '📌 Other' }
	];
	const catLabel = (v: string) => categories.find((c) => c.value === v)?.label ?? '📌 Other';

	function fmtDay(d: string) {
		return new Date(d).toLocaleDateString(undefined, {
			weekday: 'short',
			month: 'short',
			day: 'numeric'
		});
	}

	// Group scheduled activities by day for the timeline.
	const days = $derived(
		Object.entries(
			visibleScheduled.reduce<Record<string, typeof data.scheduled>>((acc, a) => {
				(acc[a.scheduledDate!] ??= []).push(a);
				return acc;
			}, {})
		)
	);

	async function copyInvite() {
		const url = `${location.origin}/join/${data.inviteToken}`;
		try {
			await navigator.clipboard.writeText(url);
			copied = true;
			setTimeout(() => (copied = false), 1500);
		} catch {
			prompt('Copy this invite link:', url);
		}
	}
</script>

{#snippet stopCard(s: (typeof view.unassigned)[number], i: number, currentGroupId: string | null)}
	{@const maps = googleMapsUrl({ lat: s.lat, lng: s.lng, locationName: s.locationName, destination: data.trip.name })}
	<li class="relative rounded-2xl border border-slate-800 bg-slate-900 p-3">
		<span
			class="absolute -left-[1.38rem] top-3 flex h-5 w-5 items-center justify-center rounded-full bg-sky-600 text-[10px] font-bold text-white"
		>{i + 1}</span>
		<div class="flex items-baseline justify-between gap-2">
			<p class="font-semibold">{s.title}</p>
			<span class="shrink-0 text-xs text-sky-300">▲ {s.score}</span>
		</div>
		<p class="text-xs text-slate-400">
			{catLabel(s.category)}{#if s.hasCoords && i > 0} · {fmtKm(s.legKm)} from prev{/if}{#if !s.hasCoords} · no location{/if}
		</p>
		<div class="mt-2 flex flex-wrap items-center gap-2">
			{#if maps}
				<a href={maps} target="_blank" rel="noreferrer" class="rounded-full bg-slate-800 px-3 py-1 text-xs text-sky-300">🗺️ Maps</a>
			{/if}
			<form method="POST" action="?/moveItem" use:enhance>
				<input type="hidden" name="scope" value={routeScope} />
				<input type="hidden" name="activityId" value={s.id} />
				<select
					name="target"
					onchange={(e) => e.currentTarget.form?.requestSubmit()}
					class="rounded-full bg-slate-800 px-2 py-1 text-xs text-slate-200 outline-none"
				>
					<option value="none" selected={currentGroupId === null}>📂 Unassigned</option>
					{#each groupOptions as go (go.id)}
						<option value={go.id} selected={currentGroupId === go.id}>{go.name}</option>
					{/each}
				</select>
			</form>
		</div>
	</li>
{/snippet}

<header class="mb-4">
	<div class="flex items-center justify-between">
		<a href="/trips" class="text-sm text-slate-400">← Trips</a>
		<button
			onclick={() => (showSettings = !showSettings)}
			class="text-sm text-slate-400"
			aria-label="Trip settings"
		>{showSettings ? 'Done' : '⚙️ Settings'}</button>
	</div>
	<h1 class="mt-1 text-2xl font-bold">📍 {data.trip.name}</h1>
	{#if data.trip.startDate}
		<p class="text-sm text-slate-400">
			{fmtDay(data.trip.startDate)}{#if data.trip.endDate} – {fmtDay(data.trip.endDate)}{/if}
		</p>
	{/if}
</header>

{#if showSettings}
	<section class="flex flex-col gap-5">
		{#if form?.settingsError}
			<p class="rounded-lg bg-red-950 px-3 py-2 text-sm text-red-300">{form.settingsError}</p>
		{/if}
		{#if data.myRole === 'organizer'}
			<form method="POST" action="?/updateTrip" use:enhance class="flex flex-col gap-3">
				<h2 class="text-sm font-bold uppercase tracking-wide text-slate-400">Trip details</h2>
				<span class="text-xs text-slate-400">Destination</span>
				<input
					name="name"
					value={data.trip.name}
					placeholder="Destination (e.g. Berlin)"
					required
					class="-mt-1 rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-base outline-none focus:border-sky-500"
				/>
				<div class="flex gap-3">
					<label class="flex flex-1 flex-col gap-1 text-xs text-slate-400">
						Start
						<input name="startDate" type="date" value={data.trip.startDate ?? ''} class="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2.5 text-base outline-none focus:border-sky-500" />
					</label>
					<label class="flex flex-1 flex-col gap-1 text-xs text-slate-400">
						End
						<input name="endDate" type="date" value={data.trip.endDate ?? ''} class="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2.5 text-base outline-none focus:border-sky-500" />
					</label>
				</div>
				<button type="submit" class="rounded-xl bg-sky-600 py-3 font-semibold text-white active:bg-sky-700">
					{form?.tripUpdated ? '✓ Saved' : 'Save changes'}
				</button>
			</form>
		{:else}
			<p class="text-sm text-slate-400">Only an organizer can edit this trip’s details.</p>
		{/if}

		<div class="flex flex-col gap-3 rounded-2xl border border-red-900/60 p-4">
			<h2 class="text-sm font-bold uppercase tracking-wide text-red-300">Danger zone</h2>
			{#if data.canLeave}
				<form
					method="POST"
					action="?/leaveTrip"
					use:enhance
					onsubmit={(e) => { if (!confirm('Leave this trip?')) e.preventDefault(); }}
				>
					<button type="submit" class="w-full rounded-xl border border-slate-600 py-3 text-sm font-semibold text-slate-200">
						Leave trip
					</button>
				</form>
			{/if}
			{#if data.myRole === 'organizer'}
				<form
					method="POST"
					action="?/deleteTrip"
					use:enhance
					onsubmit={(e) => { if (!confirm('Delete this trip for everyone? This cannot be undone.')) e.preventDefault(); }}
				>
					<button type="submit" class="w-full rounded-xl bg-red-950/60 py-3 text-sm font-semibold text-red-300">
						Delete trip
					</button>
				</form>
			{/if}
		</div>
	</section>
{:else}

<div class="mb-5 flex rounded-xl bg-slate-800 p-1 text-xs font-medium">
	{#each [['ideas', `Activities (${data.pool.length})`], ['plan', `Plan (${data.scheduled.length})`], ['route', 'Route'], ['people', `People (${data.members.length})`]] as [key, label] (key)}
		<button
			onclick={() => (tab = key as Tab)}
			class="flex-1 rounded-lg py-2 {tab === key ? 'bg-sky-600 text-white' : 'text-slate-300'}"
		>
			{label}
		</button>
	{/each}
</div>

{#if tab === 'ideas'}
	<button
		onclick={() => (showAdd = !showAdd)}
		class="mb-4 w-full rounded-xl border border-dashed border-slate-600 py-3 text-sm font-semibold text-sky-300 active:bg-slate-800"
	>
		{showAdd ? 'Cancel' : '+ Add a place or activity'}
	</button>

	{#if showAdd}
		<form
			method="POST"
			action="?/addActivity"
			use:enhance={() =>
				async ({ update }) => {
					await update();
					showAdd = false;
				}}
			class="mb-6 flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-4"
		>
			{#if form?.error}
				<p class="rounded-lg bg-red-950 px-3 py-2 text-sm text-red-300">{form.error}</p>
			{/if}
			<input
				name="title"
				placeholder="Title (e.g. Pergamon Museum)"
				required
				class="rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-base outline-none focus:border-sky-500"
			/>
			<select
				name="category"
				class="rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-base outline-none focus:border-sky-500"
			>
				{#each categories as c (c.value)}
					<option value={c.value}>{c.label}</option>
				{/each}
			</select>
			<input
				name="locationName"
				placeholder="Location — required for the route (e.g. Pergamonmuseum)"
				required
				class="rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-base outline-none focus:border-sky-500"
			/>
			<input
				name="estCost"
				inputmode="numeric"
				placeholder="Estimated cost € (optional)"
				class="rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-base outline-none focus:border-sky-500"
			/>
			<textarea
				name="notes"
				placeholder="Notes (optional)"
				rows="2"
				class="rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-base outline-none focus:border-sky-500"
			></textarea>
			<button type="submit" class="rounded-xl bg-sky-600 py-3 font-semibold text-white active:bg-sky-700">
				Add activity
			</button>
		</form>
	{/if}

	{#if data.pool.length > 0}
		<div class="mb-4 flex rounded-xl bg-slate-800 p-1 text-sm font-medium">
			<button onclick={() => (mineOnly = false)} class="flex-1 rounded-lg py-1.5 {!mineOnly ? 'bg-sky-600 text-white' : 'text-slate-300'}">All</button>
			<button onclick={() => (mineOnly = true)} class="flex-1 rounded-lg py-1.5 {mineOnly ? 'bg-sky-600 text-white' : 'text-slate-300'}">Mine</button>
		</div>
	{/if}

	{#if visiblePool.length === 0}
		<p class="mt-10 text-center text-slate-400">
			{mineOnly ? 'Nothing of yours yet — add or upvote some activities.' : 'No activities yet. Add the first one!'}
		</p>
	{:else}
		<ul class="flex flex-col gap-3">
			{#each visiblePool as a (a.id)}
				{@const maps = googleMapsUrl({ lat: a.lat, lng: a.lng, locationName: a.locationName, destination: data.trip.name })}
				<li class="rounded-2xl border border-slate-800 bg-slate-900 p-4">
					<div class="flex gap-3">
						<!-- Upvote control (interest only) -->
						<form method="POST" action="?/vote" use:enhance>
							<input type="hidden" name="activityId" value={a.id} />
							<input type="hidden" name="value" value={a.myVote === 1 ? 0 : 1} />
							<button
								type="submit"
								aria-label={a.myVote === 1 ? 'Remove your interest' : "I'm interested"}
								class="flex h-14 w-12 flex-col items-center justify-center rounded-xl border {a.myVote === 1
									? 'border-sky-500 bg-sky-950 text-sky-300'
									: 'border-slate-700 bg-slate-800 text-slate-400'}"
							>
								<span class="text-lg leading-none">👍</span>
								<span class="text-sm font-bold">{a.score}</span>
							</button>
						</form>

						<div class="min-w-0 flex-1">
							<p class="font-semibold">{a.title}</p>
							<p class="text-xs text-slate-400">
								{catLabel(a.category)}{#if a.estCost} · €{a.estCost}{/if}
							</p>
							{#if a.locationName}<p class="mt-0.5 truncate text-xs text-slate-500">📍 {a.locationName}</p>{/if}
							{#if a.notes}<p class="mt-1 text-sm text-slate-300">{a.notes}</p>{/if}
								<p class="mt-1 text-xs text-slate-500">
									added by {a.proposedByName}{#if a.interestedNames.length} · 👍 {a.interestedNames.join(', ')}{/if}
								</p>

							<div class="mt-2 flex flex-wrap gap-2 text-xs">
								{#if maps}
									<a href={maps} target="_blank" rel="noreferrer" class="rounded-full bg-slate-800 px-3 py-1 text-sky-300">🗺️ Maps</a>
								{/if}
								<button
									onclick={() => { scheduleFor = scheduleFor === a.id ? null : a.id; editFor = null; }}
									class="rounded-full bg-slate-800 px-3 py-1 text-emerald-300"
								>🗓️ Schedule</button>
									{#if a.canEdit}
										<button
											onclick={() => { editFor = editFor === a.id ? null : a.id; scheduleFor = null; }}
											class="rounded-full bg-slate-800 px-3 py-1 text-slate-300"
										>✏️ Edit</button>
										<form
											method="POST"
											action="?/deleteActivity"
											use:enhance
											onsubmit={(e) => { if (!confirm(`Delete “${a.title}”?`)) e.preventDefault(); }}
										>
											<input type="hidden" name="activityId" value={a.id} />
											<button type="submit" class="rounded-full bg-slate-800 px-3 py-1 text-red-300">🗑 Delete</button>
										</form>
									{/if}
							</div>

							{#if editFor === a.id}
									<form
										method="POST"
										action="?/updateActivity"
										use:enhance={() => async ({ update }) => { await update(); editFor = null; }}
										class="mt-3 flex flex-col gap-2 rounded-xl bg-slate-800 p-3"
									>
										<input type="hidden" name="activityId" value={a.id} />
										<input name="title" value={a.title} required class="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-base" />
										<select name="category" class="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-base">
											{#each categories as c (c.value)}
												<option value={c.value} selected={c.value === a.category}>{c.label}</option>
											{/each}
										</select>
										<input name="locationName" value={a.locationName ?? ''} placeholder="Location (required)" required class="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-base" />
										<input name="estCost" value={a.estCost ?? ''} inputmode="numeric" placeholder="Estimated cost €" class="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-base" />
										<textarea name="notes" rows="2" placeholder="Notes" class="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-base">{a.notes ?? ''}</textarea>
										<button type="submit" class="rounded-lg bg-sky-600 py-2 text-sm font-semibold text-white">Save changes</button>
									</form>
								{/if}

								{#if scheduleFor === a.id}
								<form
									method="POST"
									action="?/schedule"
									use:enhance={() => async ({ update }) => { await update(); scheduleFor = null; }}
									class="mt-3 flex flex-col gap-2 rounded-xl bg-slate-800 p-3"
								>
									<input type="hidden" name="activityId" value={a.id} />
									<input
										name="scheduledDate"
										type="date"
										required
										value={data.trip.startDate ?? ''}
										class="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-base"
									/>
									<div class="flex gap-2">
										<input name="startTime" type="time" class="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-base" />
										<input name="durationMin" inputmode="numeric" placeholder="mins" class="w-24 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-base" />
									</div>
									<button type="submit" class="rounded-lg bg-emerald-600 py-2 text-sm font-semibold text-white">Add to plan</button>
								</form>
							{/if}
						</div>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
{:else if tab === 'plan'}
	{#if data.scheduled.length > 0}
		<div class="mb-4 flex rounded-xl bg-slate-800 p-1 text-sm font-medium">
			<button onclick={() => (mineOnly = false)} class="flex-1 rounded-lg py-1.5 {!mineOnly ? 'bg-sky-600 text-white' : 'text-slate-300'}">All</button>
			<button onclick={() => (mineOnly = true)} class="flex-1 rounded-lg py-1.5 {mineOnly ? 'bg-sky-600 text-white' : 'text-slate-300'}">Mine</button>
		</div>
	{/if}
	{#if days.length === 0}
		<p class="mt-10 text-center text-slate-400">
			{mineOnly
				? 'None of your activities are scheduled yet.'
				: 'Nothing scheduled yet. Schedule activities from the Activities tab.'}
		</p>
	{:else}
		{#if planTotal > 0}
			<p class="mb-4 rounded-xl bg-slate-900 px-4 py-3 text-sm text-slate-300">
				Estimated total: <span class="font-semibold text-white">{eur(planTotal)}</span>
				<span class="text-slate-500">· per person if split, divide by {data.members.length}</span>
			</p>
		{/if}
		<div class="flex flex-col gap-6">
			{#each days as [day, items] (day)}
				<section>
					<div class="mb-2 flex items-baseline justify-between">
						<h2 class="text-sm font-bold uppercase tracking-wide text-slate-400">{fmtDay(day)}</h2>
						{#if items.reduce((s, a) => s + (a.estCost ?? 0), 0) > 0}
							<span class="text-xs text-slate-500">{eur(items.reduce((s, a) => s + (a.estCost ?? 0), 0))}</span>
						{/if}
					</div>
					<ul class="relative flex flex-col gap-3 border-l border-slate-700 pl-4">
						{#each items as a (a.id)}
							{@const maps = googleMapsUrl({ lat: a.lat, lng: a.lng, locationName: a.locationName, destination: data.trip.name })}
							<li class="relative rounded-2xl border border-slate-800 bg-slate-900 p-3">
								<span class="absolute -left-[1.42rem] top-4 h-2.5 w-2.5 rounded-full bg-sky-500"></span>
								<div class="flex items-baseline justify-between gap-2">
									<p class="font-semibold">{a.title}</p>
									{#if a.startTime}<span class="text-sm text-sky-300">{a.startTime}</span>{/if}
								</div>
								<p class="text-xs text-slate-400">
									{catLabel(a.category)}{#if a.durationMin} · {a.durationMin} min{/if}{#if a.estCost} · €{a.estCost}{/if}
								</p>
								<div class="mt-2 flex flex-wrap gap-2 text-xs">
									{#if maps}
										<a href={maps} target="_blank" rel="noreferrer" class="rounded-full bg-slate-800 px-3 py-1 text-sky-300">🗺️ Maps</a>
									{/if}
									<form method="POST" action="?/schedule" use:enhance>
										<input type="hidden" name="activityId" value={a.id} />
										<input type="hidden" name="scheduledDate" value="" />
										<button type="submit" class="rounded-full bg-slate-800 px-3 py-1 text-slate-400">↩ Back to ideas</button>
									</form>
								</div>
							</li>
						{/each}
					</ul>
				</section>
			{/each}
		</div>
	{/if}
{:else if tab === 'route'}
	<div class="mb-3 flex rounded-xl bg-slate-800 p-1 text-sm font-medium">
		{#each [['mine', 'Mine'], ['shared', 'Shared']] as [k, l] (k)}
			<button
				onclick={() => (routeScope = k as Scope)}
				class="flex-1 rounded-lg py-2 {routeScope === k ? 'bg-sky-600 text-white' : 'text-slate-300'}"
			>{l}</button>
		{/each}
	</div>
	<p class="mb-4 text-xs text-slate-400">
		{#if routeScope === 'mine'}
			Your personal plan from places <span class="text-slate-200">you added or upvoted</span> — only you see it.
		{:else}
			Shared with everyone on the trip — any member can edit, across all the trip's places.
		{/if}
		Stops are ordered most-voted first, then by what's nearest.
	</p>

	<div class="mb-4 flex gap-2">
		<form method="POST" action="?/autoSplitDays" use:enhance class="flex-1">
			<input type="hidden" name="scope" value={routeScope} />
			<button
				type="submit"
				class="w-full rounded-xl bg-emerald-700 py-2.5 text-sm font-semibold text-white active:bg-emerald-800"
			>🗓️ Auto-split into days</button>
		</form>
		<button
			onclick={() => (showAddGroup = !showAddGroup)}
			class="rounded-xl border border-slate-600 px-3 py-2.5 text-sm font-semibold text-sky-300"
		>+ Group</button>
	</div>

	{#if showAddGroup}
		<form
			method="POST"
			action="?/createGroup"
			use:enhance={() => async ({ update }) => { await update(); showAddGroup = false; }}
			class="mb-4 flex gap-2"
		>
			<input type="hidden" name="scope" value={routeScope} />
			<input
				name="name"
				placeholder="Group name (e.g. Rainy day, Must-see)"
				required
				class="flex-1 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2.5 text-base outline-none focus:border-sky-500"
			/>
			<button type="submit" class="rounded-xl bg-sky-600 px-4 text-sm font-semibold text-white">Add</button>
		</form>
	{/if}

	{#if view.groups.length === 0 && view.unassigned.length === 0}
		<p class="mt-10 text-center text-slate-400">
			Add or upvote some places (with a location) and your route will appear here.
		</p>
	{:else}
		{#each view.groups as g (g.id)}
			<section class="mb-5">
				<div class="mb-2 flex items-center justify-between gap-2">
					<h2 class="truncate text-sm font-bold uppercase tracking-wide text-slate-200">
						{g.name}{#if g.dayDate} · {fmtDay(g.dayDate)}{/if}
					</h2>
					<div class="flex shrink-0 items-center gap-3">
						{#if g.mapsUrl}
							<a href={g.mapsUrl} target="_blank" rel="noreferrer" class="text-xs text-sky-300">🗺️ Route</a>
						{/if}
						<form method="POST" action="?/deleteGroup" use:enhance>
							<input type="hidden" name="groupId" value={g.id} />
							<button type="submit" class="text-xs text-slate-500" aria-label="Delete group">✕</button>
						</form>
					</div>
				</div>
				{#if g.stops.length === 0}
					<p class="pl-1 text-xs text-slate-500">Empty — move stops here from below.</p>
				{:else}
					<ol class="relative flex flex-col gap-2 border-l border-slate-700 pl-5">
						{#each g.stops as s, i (s.id)}
							{@render stopCard(s, i, g.id)}
						{/each}
					</ol>
				{/if}
			</section>
		{/each}

		<section>
			<div class="mb-2 flex items-center justify-between gap-2">
				<h2 class="text-sm font-bold uppercase tracking-wide text-slate-400">
					{view.groups.length ? 'Unassigned' : 'Suggested route'}
				</h2>
				{#if view.unassignedMapsUrl}
					<a href={view.unassignedMapsUrl} target="_blank" rel="noreferrer" class="text-xs text-sky-300">🗺️ Route</a>
				{/if}
			</div>
			{#if view.unassigned.length === 0}
				<p class="pl-1 text-xs text-slate-500">Everything’s grouped. 🎉</p>
			{:else}
				<ol class="relative flex flex-col gap-2 border-l border-slate-700 pl-5">
					{#each view.unassigned as s, i (s.id)}
						{@render stopCard(s, i, null)}
					{/each}
				</ol>
			{/if}
		</section>
	{/if}
{:else}
	<button
		onclick={copyInvite}
		class="mb-5 w-full rounded-xl bg-sky-600 py-3 text-sm font-semibold text-white active:bg-sky-700"
	>
		{copied ? '✓ Link copied' : '🔗 Copy invite link'}
	</button>
	<p class="-mt-3 mb-5 text-center text-xs text-slate-500">
		Anyone with the link can join — even if they’re not your friend yet.
	</p>

	<ul class="flex flex-col gap-2">
		{#each data.members as m (m.id)}
			<li class="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-900 p-3">
				<div class="min-w-0">
					<p class="truncate font-semibold">
						{m.name}
						{#if m.role === 'organizer'}<span class="ml-1 rounded-full bg-sky-950 px-2 py-0.5 text-xs text-sky-300">organizer</span>{/if}
					</p>
				</div>
				{#if m.friendStatus === 'none'}
					<form method="POST" action="?/addFriend" use:enhance>
						<input type="hidden" name="targetId" value={m.id} />
						<button type="submit" class="rounded-full bg-slate-800 px-3 py-1.5 text-xs font-semibold text-sky-300">+ Add friend</button>
					</form>
				{:else if m.friendStatus === 'accepted'}
					<span class="text-xs text-emerald-400">✓ Friends</span>
				{:else if m.friendStatus === 'sent'}
					<span class="text-xs text-slate-500">Request sent</span>
				{:else if m.friendStatus === 'received'}
					<form method="POST" action="?/addFriend" use:enhance>
						<input type="hidden" name="targetId" value={m.id} />
						<button type="submit" class="rounded-full bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white">Accept</button>
					</form>
				{/if}
			</li>
		{/each}
	</ul>
{/if}
{/if}
