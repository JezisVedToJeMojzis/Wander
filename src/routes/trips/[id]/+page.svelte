<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { dndzone } from 'svelte-dnd-action';
	import { googleMapsUrl } from '$lib/maps';

	let { data, form } = $props();

	type Tab = 'ideas' | 'plan' | 'people';
	let tab = $state<Tab>('ideas');

	const fmtKm = (km: number) => (km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`);
	const mapsFor = (x: { lat?: string | null; lng?: string | null; locationName?: string | null }) =>
		googleMapsUrl({ lat: x.lat, lng: x.lng, locationName: x.locationName, destination: data.trip.name });

	let showAdd = $state(false);
	let scheduleFor = $state<string | null>(null);
	let editFor = $state<string | null>(null);
	let nearbyFor = $state<string | null>(null);
	let copied = $state(false);
	let showSettings = $state(false);
	let mineOnly = $state(false); // "All vs Mine" filter for Activities
	let catFilter = $state('all'); // category filter for Activities

	// "Mine" = activities I proposed or upvoted.
	const isMine = (a: { proposedByName: string; myVote: number }) =>
		a.proposedByName === 'You' || a.myVote === 1;

	const presentCats = $derived<string[]>([...new Set(data.pool.map((a) => a.category as string))]);
	const visiblePool = $derived(
		data.pool
			.filter((a) => !mineOnly || isMine(a))
			.filter((a) => catFilter === 'all' || a.category === catFilter)
	);

	const eur = (n: number) => `€${n.toLocaleString()}`;
	const planTotal = $derived(data.days.reduce((s, d) => s + d.total, 0));

	const categories = [
		{ value: 'food', label: '🍽️ Food' },
		{ value: 'cafe', label: '☕ Café' },
		{ value: 'sightseeing', label: '🏛️ Sightseeing' },
		{ value: 'museum', label: '🖼️ Museum' },
		{ value: 'culture', label: '🎭 Culture' },
		{ value: 'streetart', label: '🎨 Street art' },
		{ value: 'shopping', label: '🛍️ Shopping' },
		{ value: 'thrifting', label: '🧥 Thrifting' },
		{ value: 'market', label: '🛒 Market' },
		{ value: 'nature', label: '🌳 Nature' },
		{ value: 'outdoors', label: '🥾 Outdoors' },
		{ value: 'beach', label: '🏖️ Beach' },
		{ value: 'sport', label: '⚽ Sport' },
		{ value: 'clubbing', label: '🪩 Clubbing' },
		{ value: 'bar', label: '🍸 Bar' },
		{ value: 'other', label: '📌 Other' }
	];
	const catLabel = (v: string) => categories.find((c) => c.value === v)?.label ?? '📌 Other';
	const catIcon = (v: string) => catLabel(v).split(' ')[0];

	function fmtDay(d: string) {
		return new Date(d).toLocaleDateString(undefined, {
			weekday: 'short',
			month: 'short',
			day: 'numeric'
		});
	}

	// --- Plan drag-and-drop ---------------------------------------------------
	type PlanItem = (typeof data.days)[number]['items'][number];
	type PlanDay = (typeof data.days)[number];
	let planDays = $state<PlanDay[]>([]);
	$effect(() => {
		planDays = data.days.map((d) => ({ ...d, items: [...d.items] }));
	});

	// Per-day "start the route from the accommodation" toggle (defaults on when set).
	let accomStart = $state<Record<string, boolean>>({});
	const usesAccom = (date: string) => accomStart[date] ?? data.hasAccommodation;
	const routeHref = (day: PlanDay) =>
		usesAccom(day.date) && day.mapsUrlFromAccom ? day.mapsUrlFromAccom : day.mapsUrl;

	function considerDay(day: PlanDay, e: CustomEvent<{ items: PlanItem[] }>) {
		day.items = e.detail.items;
	}
	async function finalizeDay(day: PlanDay, e: CustomEvent<{ items: PlanItem[] }>) {
		day.items = e.detail.items;
		const fd = new FormData();
		fd.set('scheduledDate', day.date);
		for (const it of day.items) fd.append('ids', it.id);
		await fetch('?/reorderDay', { method: 'POST', headers: { 'x-sveltekit-action': 'true' }, body: fd });
		await invalidateAll();
	}

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

{#snippet nearbyList(items: PlanItem['nearbySameDay'])}
	<div class="mt-3 rounded-xl bg-slate-800 p-3">
		<p class="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Closest activities</p>
		<ul class="flex flex-col gap-1.5">
			{#each items as n (n.id)}
				{@const m = mapsFor(n)}
				<li class="flex items-center justify-between gap-2 text-sm">
					<span class="min-w-0 truncate text-slate-200">{catIcon(n.category)} {n.title}</span>
					<span class="flex shrink-0 items-center gap-2">
						<span class="text-xs text-sky-300">{fmtKm(n.km)}</span>
						{#if m}<a href={m} target="_blank" rel="noreferrer" class="rounded-full bg-slate-700 px-2 py-0.5 text-xs text-sky-300">🗺️</a>{/if}
					</span>
				</li>
			{/each}
		</ul>
	</div>
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
	{#if data.trip.accommodationName}
		<p class="text-xs text-slate-500">🏠 {data.trip.accommodationName}</p>
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
				<label class="flex flex-col gap-1 text-xs text-slate-400">
					Destination
					<input
						name="name"
						value={data.trip.name}
						placeholder="Destination (e.g. Berlin)"
						required
						class="rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-base text-slate-100 outline-none focus:border-sky-500"
					/>
				</label>
				<label class="flex flex-col gap-1 text-xs text-slate-400">
					Accommodation (optional — sets distances &amp; day-route start)
					<input
						name="accommodationName"
						value={data.trip.accommodationName ?? ''}
						placeholder="e.g. Hotel Adlon, or a full address"
						class="rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-base text-slate-100 outline-none focus:border-sky-500"
					/>
				</label>
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
	{#each [['ideas', `Activities (${data.pool.length})`], ['plan', `Plan (${data.scheduledCount})`], ['people', `People (${data.members.length})`]] as [key, label] (key)}
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
			<div class="relative">
				<select
					name="category"
					class="w-full appearance-none rounded-xl border border-slate-700 bg-slate-800 py-3 pl-4 pr-10 text-base text-slate-100 outline-none focus:border-sky-500"
				>
					{#each categories as c (c.value)}
						<option value={c.value}>{c.label}</option>
					{/each}
				</select>
				<span class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-slate-400">▾</span>
			</div>
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
		<div class="mb-4 flex gap-2">
			<div class="flex flex-1 rounded-xl bg-slate-800 p-1 text-sm font-medium">
				<button onclick={() => (mineOnly = false)} class="flex-1 rounded-lg py-1.5 {!mineOnly ? 'bg-sky-600 text-white' : 'text-slate-300'}">All</button>
				<button onclick={() => (mineOnly = true)} class="flex-1 rounded-lg py-1.5 {mineOnly ? 'bg-sky-600 text-white' : 'text-slate-300'}">Mine</button>
			</div>
			<div class="relative">
				<select
					bind:value={catFilter}
					aria-label="Filter by category"
					class="h-full w-full appearance-none rounded-xl border border-slate-700 bg-slate-800 py-2 pl-4 pr-10 text-sm text-slate-200 outline-none focus:border-sky-500"
				>
					<option value="all">All types</option>
					{#each categories.filter((c) => presentCats.includes(c.value)) as c (c.value)}
						<option value={c.value}>{c.label}</option>
					{/each}
				</select>
				<span class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-slate-400">▾</span>
			</div>
		</div>
	{/if}

	{#if visiblePool.length === 0}
		<p class="mt-10 text-center text-slate-400">
			{#if data.pool.length === 0}
				No activities yet. Add the first one!
			{:else}
				Nothing matches this filter.
			{/if}
		</p>
	{:else}
		<ul class="flex flex-col gap-3">
			{#each visiblePool as a (a.id)}
				{@const maps = mapsFor(a)}
				<li class="rounded-2xl border border-slate-800 bg-slate-900 p-4">
					<div class="flex gap-3">
						<!-- Upvote control (anonymous — count only) -->
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
								{catLabel(a.category)}{#if a.estCost} · €{a.estCost}{/if}{#if a.distFromAccom != null} · 🏠 {fmtKm(a.distFromAccom)}{/if}
							</p>
							{#if a.locationName}<p class="mt-0.5 truncate text-xs text-slate-500">📍 {a.locationName}</p>{/if}
							{#if a.notes}<p class="mt-1 text-sm text-slate-300">{a.notes}</p>{/if}
							<p class="mt-1 text-xs text-slate-500">added by {a.proposedByName}</p>

							<div class="mt-2 flex flex-wrap gap-2 text-xs">
								{#if maps}
									<a href={maps} target="_blank" rel="noreferrer" class="rounded-full bg-slate-800 px-3 py-1 text-sky-300">🗺️ Maps</a>
								{/if}
								<button
									onclick={() => { scheduleFor = scheduleFor === a.id ? null : a.id; editFor = null; nearbyFor = null; }}
									class="rounded-full bg-slate-800 px-3 py-1 text-emerald-300"
								>🗓️ Schedule</button>
								{#if a.nearby.length}
									<button
										onclick={() => { nearbyFor = nearbyFor === a.id ? null : a.id; }}
										class="rounded-full bg-slate-800 px-3 py-1 text-slate-300"
									>📍 Nearby</button>
								{/if}
								{#if a.canEdit}
									<button
										onclick={() => { editFor = editFor === a.id ? null : a.id; scheduleFor = null; nearbyFor = null; }}
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

							{#if nearbyFor === a.id}
								{@render nearbyList(a.nearby)}
							{/if}

							{#if editFor === a.id}
								<form
									method="POST"
									action="?/updateActivity"
									use:enhance={() => async ({ update }) => { await update(); editFor = null; }}
									class="mt-3 flex flex-col gap-2 rounded-xl bg-slate-800 p-3"
								>
									<input type="hidden" name="activityId" value={a.id} />
									<input name="title" value={a.title} required class="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-base" />
									<div class="relative">
										<select name="category" class="w-full appearance-none rounded-lg border border-slate-700 bg-slate-900 py-2 pl-3 pr-10 text-base text-slate-100">
											{#each categories as c (c.value)}
												<option value={c.value} selected={c.value === a.category}>{c.label}</option>
											{/each}
										</select>
										<span class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-slate-400">▾</span>
									</div>
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
									<label class="flex flex-col gap-1 text-xs text-slate-400">
										Which day?
										<input
											name="scheduledDate"
											type="date"
											required
											value={data.trip.startDate ?? ''}
											class="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-base"
										/>
									</label>
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
	{#if planDays.length === 0}
		<p class="mt-10 text-center text-slate-400">
			Nothing scheduled yet. Schedule activities from the Activities tab, then drag to order each day.
		</p>
	{:else}
		{#if planTotal > 0}
			<p class="mb-4 rounded-xl bg-slate-900 px-4 py-3 text-sm text-slate-300">
				Estimated total: <span class="font-semibold text-white">{eur(planTotal)}</span>
				<span class="text-slate-500">· per person if split, divide by {data.members.length}</span>
			</p>
		{/if}
		<p class="mb-4 text-xs text-slate-500">Drag to set the order you’ll do things. 🗺️ Route opens that day’s stops in Google Maps in this order.</p>
		<div class="flex flex-col gap-6">
			{#each planDays as day (day.date)}
				<section>
					<div class="mb-2 flex items-center justify-between gap-2">
						<h2 class="text-sm font-bold uppercase tracking-wide text-slate-400">{fmtDay(day.date)}</h2>
						<div class="flex shrink-0 items-center gap-3">
							{#if day.total > 0}<span class="text-xs text-slate-500">{eur(day.total)}</span>{/if}
							{#if day.mapsUrlFromAccom}
								<label class="flex items-center gap-1 text-xs text-slate-400">
									<input type="checkbox" checked={usesAccom(day.date)} onchange={(e) => (accomStart[day.date] = e.currentTarget.checked)} class="accent-sky-500" />
									🏠
								</label>
							{/if}
							{#if routeHref(day)}
								<a href={routeHref(day)} target="_blank" rel="noreferrer" class="text-xs font-semibold text-sky-300">🗺️ Route</a>
							{/if}
						</div>
					</div>
					<ul
						use:dndzone={{ items: day.items, flipDurationMs: 150, type: `day-${day.date}`, dropTargetStyle: {} }}
						onconsider={(e) => considerDay(day, e)}
						onfinalize={(e) => finalizeDay(day, e)}
						class="flex flex-col gap-2"
					>
						{#each day.items as a, i (a.id)}
							{@const maps = mapsFor(a)}
							<li class="flex items-start gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-3 {a.done ? 'opacity-50' : ''}">
								<span class="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white {a.done ? 'bg-slate-600' : 'bg-sky-600'}">{a.done ? '✓' : i + 1}</span>
								<div class="min-w-0 flex-1">
									<div class="flex items-baseline justify-between gap-2">
										<p class="truncate font-semibold {a.done ? 'line-through' : ''}">{a.title}</p>
										<span class="shrink-0 select-none text-slate-600" aria-hidden="true">⠿</span>
									</div>
									<p class="text-xs text-slate-400">
										{catLabel(a.category)}<span class="text-slate-500"> · 👍 {a.score}</span>{#if a.estCost} · €{a.estCost}{/if}{#if a.distFromAccom != null} · 🏠 {fmtKm(a.distFromAccom)}{/if}
									</p>
									{#if a.locationName}<p class="mt-0.5 truncate text-xs text-slate-500">📍 {a.locationName}</p>{/if}
									{#if a.notes}<p class="mt-1 line-clamp-2 text-xs leading-snug text-slate-500">{a.notes}</p>{/if}
									<div class="mt-2 flex flex-wrap gap-2 text-xs">
										{#if maps}
											<a href={maps} target="_blank" rel="noreferrer" class="rounded-full bg-slate-800 px-3 py-1 text-sky-300">🗺️ Maps</a>
										{/if}
										{#if a.nearbySameDay.length}
											<button
												onclick={() => { nearbyFor = nearbyFor === a.id ? null : a.id; }}
												class="rounded-full bg-slate-800 px-3 py-1 text-slate-300"
											>📍 Nearby</button>
										{/if}
										<form method="POST" action="?/toggleDone" use:enhance>
											<input type="hidden" name="activityId" value={a.id} />
											<input type="hidden" name="done" value={a.done ? 'false' : 'true'} />
											<button type="submit" class="rounded-full bg-slate-800 px-3 py-1 {a.done ? 'text-slate-400' : 'text-emerald-300'}">
												{a.done ? '↺ Not done' : '✓ Done'}
											</button>
										</form>
										<form method="POST" action="?/schedule" use:enhance>
											<input type="hidden" name="activityId" value={a.id} />
											<input type="hidden" name="scheduledDate" value="" />
											<button type="submit" class="rounded-full bg-slate-800 px-3 py-1 text-slate-400">↩ Back to ideas</button>
										</form>
									</div>
									{#if nearbyFor === a.id}
										{@render nearbyList(a.nearbySameDay)}
									{/if}
								</div>
							</li>
						{/each}
					</ul>
				</section>
			{/each}
		</div>
	{/if}
{:else}
	<button
		onclick={copyInvite}
		class="mb-3 w-full rounded-xl bg-sky-600 py-3 text-sm font-semibold text-white active:bg-sky-700"
	>
		{copied ? '✓ Link copied' : '🔗 Copy invite link'}
	</button>
	<p class="-mt-1 mb-5 text-center text-xs text-slate-500">
		Share this link to add people. No account? They’ll be prompted to make one, then land straight in the trip.
	</p>

	<h2 class="mb-2 text-sm font-bold uppercase tracking-wide text-slate-400">On this trip</h2>
	<ul class="flex flex-col gap-2">
		{#each data.members as m (m.id)}
			<li class="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-900 p-3">
				<p class="truncate font-semibold">
					{m.name}
					{#if m.role === 'organizer'}<span class="ml-1 rounded-full bg-sky-950 px-2 py-0.5 text-xs text-sky-300">organizer</span>{/if}
				</p>
			</li>
		{/each}
	</ul>
{/if}
{/if}
