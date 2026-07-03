import { error, fail, redirect } from '@sveltejs/kit';
import { randomBytes } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import {
	activities,
	activityVotes,
	tripInvites,
	tripMembers,
	trips,
	users
} from '$lib/server/db/schema';
import { geocode } from '$lib/server/geocode';
import { haversineKm } from '$lib/route';
import { googleMapsDirectionsUrl } from '$lib/maps';
import type { Actions, PageServerLoad } from './$types';

async function requireMembership(tripId: string, userId: string) {
	const db = await getDb();
	const member = await db
		.select({ role: tripMembers.role })
		.from(tripMembers)
		.where(and(eq(tripMembers.tripId, tripId), eq(tripMembers.userId, userId)))
		.limit(1);
	if (!member[0]) throw error(403, 'You are not part of this trip.');
	return { db, role: member[0].role };
}

// Geocode a place using the trip's destination (its name) as a disambiguating hint,
// so short inputs like "Colosseum" resolve to the right city.
async function geocodeForTrip(
	db: Awaited<ReturnType<typeof getDb>>,
	tripId: string,
	locationName: string
) {
	const trip = (
		await db.select({ name: trips.name }).from(trips).where(eq(trips.id, tripId)).limit(1)
	)[0];
	const query = trip?.name ? `${locationName}, ${trip.name}` : locationName;
	return geocode(query);
}

const hasCoords = (a: { lat: string | null; lng: string | null }) =>
	!!a.lat && !!a.lng && Number.isFinite(Number(a.lat)) && Number.isFinite(Number(a.lng));

// Fire-and-forget: geocode the given activities and persist their coordinates. adapter-node
// is long-lived, so this keeps running after the response is sent — page loads and writes
// never block on Nominatim. Coordinates (and thus routes/distances) appear on the next visit.
function backfillCoords(
	db: Awaited<ReturnType<typeof getDb>>,
	tripId: string,
	items: Array<{ id: string; locationName: string }>
) {
	void (async () => {
		for (const it of items) {
			try {
				const geo = await geocodeForTrip(db, tripId, it.locationName);
				if (geo) {
					await db
						.update(activities)
						.set({ lat: geo.lat, lng: geo.lng })
						.where(and(eq(activities.id, it.id), eq(activities.tripId, tripId)));
				}
			} catch {
				/* best-effort */
			}
		}
	})();
}

export const load: PageServerLoad = async ({ params, locals }) => {
	const me = locals.user!;
	const { db, role } = await requireMembership(params.id, me.id);

	const tripRow = await db.select().from(trips).where(eq(trips.id, params.id)).limit(1);
	const trip = tripRow[0];
	if (!trip) throw error(404, 'Trip not found.');

	// Accommodation point (if set + geocoded) for distances and day-route starts.
	const accom = hasCoords({ lat: trip.accommodationLat, lng: trip.accommodationLng })
		? { lat: Number(trip.accommodationLat), lng: Number(trip.accommodationLng) }
		: null;

	// Members (join to get names). Anyone joins via the share link, so this is a flat list.
	const members = await db
		.select({ id: users.id, name: users.name, role: tripMembers.role })
		.from(tripMembers)
		.innerJoin(users, eq(tripMembers.userId, users.id))
		.where(eq(tripMembers.tripId, params.id));

	// You can leave unless you're the sole organizer (then you must delete or hand off).
	const organizerCount = members.filter((m) => m.role === 'organizer').length;
	const canLeave = !(role === 'organizer' && organizerCount === 1);

	// Activities + vote tallies.
	const acts = await db.select().from(activities).where(eq(activities.tripId, params.id));
	const actIds = acts.map((a) => a.id);
	const allVotes = actIds.length
		? await db.select().from(activityVotes).where(inArray(activityVotes.activityId, actIds))
		: [];

	// Geocode any activities still missing coordinates in the background — never block the
	// page render on Nominatim. They pick up a route/distance on the next visit.
	const needsGeo = acts.filter((a) => !hasCoords(a) && a.locationName);
	if (needsGeo.length) {
		backfillCoords(db, params.id, needsGeo.map((a) => ({ id: a.id, locationName: a.locationName! })));
	}

	const nameById = new Map(members.map((m) => [m.id, m.name]));
	const actById = new Map(acts.map((a) => [a.id, a]));

	// Build a "nearest places" list from a source point over a candidate set. Each entry
	// carries what's needed to render a Google Maps link for that place.
	type CoordAct = { id: string; lat: number; lng: number };
	const nearestFrom = (
		src: { lat: number; lng: number },
		candidates: CoordAct[],
		excludeId: string,
		limit?: number
	) => {
		const list = candidates
			.filter((o) => o.id !== excludeId)
			.map((o) => {
				const full = actById.get(o.id)!;
				return {
					id: o.id,
					title: full.title,
					category: full.category,
					locationName: full.locationName,
					lat: full.lat,
					lng: full.lng,
					km: haversineKm(src, o)
				};
			})
			.sort((x, y) => x.km - y.km);
		return limit ? list.slice(0, limit) : list;
	};

	const coordActs: CoordAct[] = acts
		.filter(hasCoords)
		.map((a) => ({ id: a.id, lat: Number(a.lat), lng: Number(a.lng) }));

	const decorated = acts.map((a) => {
		const votes = allVotes.filter((v) => v.activityId === a.id);
		const score = votes.reduce((s, v) => s + v.value, 0); // anonymous — count only
		const myVote = votes.find((v) => v.userId === me.id)?.value ?? 0;
		const proposedByName =
			a.proposedBy === me.id ? 'You' : (nameById.get(a.proposedBy) ?? 'Someone');
		const canEdit = a.proposedBy === me.id || role === 'organizer';
		const distFromAccom =
			accom && hasCoords(a) ? haversineKm(accom, { lat: Number(a.lat), lng: Number(a.lng) }) : null;
		const nearby = hasCoords(a)
			? nearestFrom({ lat: Number(a.lat), lng: Number(a.lng) }, coordActs, a.id, 5)
			: [];
		return { ...a, score, myVote, proposedByName, canEdit, distFromAccom, nearby };
	});

	const pool = decorated
		.filter((a) => !a.scheduledDate)
		.sort((a, b) => b.score - a.score);

	// Scheduled activities grouped into days; within a day, ordered by the manual drag order.
	const scheduledActs = decorated
		.filter((a) => a.scheduledDate)
		.sort(
			(a, b) =>
				(a.scheduledDate! < b.scheduledDate! ? -1 : a.scheduledDate! > b.scheduledDate! ? 1 : 0) ||
				a.dayOrder - b.dayOrder ||
				(a.createdAt < b.createdAt ? -1 : 1)
		);

	const dayMap = new Map<string, typeof scheduledActs>();
	for (const a of scheduledActs) {
		const list = dayMap.get(a.scheduledDate!) ?? [];
		list.push(a);
		dayMap.set(a.scheduledDate!, list);
	}
	const days = [...dayMap.entries()]
		.sort((a, b) => (a[0] < b[0] ? -1 : 1))
		.map(([date, dayItems]) => {
			// Same-day coordinate set, so "nearby" in the Plan only considers this day.
			const dayCoords: CoordAct[] = dayItems
				.filter(hasCoords)
				.map((a) => ({ id: a.id, lat: Number(a.lat), lng: Number(a.lng) }));
			const items = dayItems.map((a) => ({
				...a,
				nearbySameDay: hasCoords(a)
					? nearestFrom({ lat: Number(a.lat), lng: Number(a.lng) }, dayCoords, a.id)
					: []
			}));
			const routePoints = dayItems.filter(hasCoords).map((a) => ({ lat: a.lat!, lng: a.lng! }));
			return {
				date,
				items,
				mapsUrl: googleMapsDirectionsUrl(routePoints),
				// Same route, but starting from the accommodation (toggleable in the UI).
				mapsUrlFromAccom:
					accom && routePoints.length >= 1
						? googleMapsDirectionsUrl([
								{ lat: String(accom.lat), lng: String(accom.lng) },
								...routePoints
							])
						: null,
				total: dayItems.reduce((s, a) => s + (a.estCost ?? 0), 0)
			};
		});

	// Ensure a share-link invite exists so it's always ready to copy.
	let invite = (
		await db.select().from(tripInvites).where(eq(tripInvites.tripId, params.id)).limit(1)
	)[0];
	if (!invite) {
		const token = randomBytes(12).toString('hex');
		invite = (
			await db
				.insert(tripInvites)
				.values({ token, tripId: params.id, createdBy: me.id })
				.returning()
		)[0];
	}

	return {
		trip,
		myRole: role,
		members,
		pool,
		days,
		scheduledCount: scheduledActs.length,
		inviteToken: invite.token,
		canLeave,
		hasAccommodation: !!accom
	};
};

export const actions: Actions = {
	addActivity: async ({ params, request, locals }) => {
		const me = locals.user!;
		const { db } = await requireMembership(params.id, me.id);
		const data = await request.formData();
		const title = String(data.get('title') ?? '').trim();
		if (!title) return fail(400, { error: 'Activity needs a title.' });
		const locationName = String(data.get('locationName') ?? '').trim();
		if (!locationName) return fail(400, { error: 'Add a location — it’s needed to plan the route.' });

		const category = String(data.get('category') ?? 'other');
		const estCostRaw = String(data.get('estCost') ?? '').trim();
		const estCost = estCostRaw ? Number.parseInt(estCostRaw, 10) : null;

		const inserted = await db
			.insert(activities)
			.values({
				tripId: params.id,
				title,
				category: category as never,
				locationName,
				notes: String(data.get('notes') ?? '').trim() || null,
				estCost: Number.isFinite(estCost) ? estCost : null,
				proposedBy: me.id
			})
			.returning({ id: activities.id });

		// Geocode in the background so adding feels instant. The Maps link works off the name
		// right away; the route/distance fill in on the next load.
		backfillCoords(db, params.id, [{ id: inserted[0].id, locationName }]);

		return { added: true };
	},

	updateActivity: async ({ params, request, locals }) => {
		const me = locals.user!;
		const { db, role } = await requireMembership(params.id, me.id);
		const data = await request.formData();
		const activityId = String(data.get('activityId') ?? '');
		const title = String(data.get('title') ?? '').trim();
		if (!title) return fail(400, { error: 'Activity needs a title.' });

		const existing = (
			await db
				.select()
				.from(activities)
				.where(and(eq(activities.id, activityId), eq(activities.tripId, params.id)))
				.limit(1)
		)[0];
		if (!existing) return fail(404, { error: 'Activity not found.' });
		if (existing.proposedBy !== me.id && role !== 'organizer') {
			return fail(403, { error: 'Only the proposer or an organizer can edit this.' });
		}

		const locationName = String(data.get('locationName') ?? '').trim();
		if (!locationName) return fail(400, { error: 'Add a location — it’s needed to plan the route.' });
		const category = String(data.get('category') ?? 'other');
		const estCostRaw = String(data.get('estCost') ?? '').trim();
		const estCost = estCostRaw ? Number.parseInt(estCostRaw, 10) : null;

		// When the location text changes, clear the coordinates and re-derive them in the
		// background so the save returns immediately.
		const locationChanged = locationName !== existing.locationName;
		await db
			.update(activities)
			.set({
				title,
				category: category as never,
				locationName,
				lat: locationChanged ? null : existing.lat,
				lng: locationChanged ? null : existing.lng,
				notes: String(data.get('notes') ?? '').trim() || null,
				estCost: Number.isFinite(estCost) ? estCost : null
			})
			.where(eq(activities.id, activityId));
		if (locationChanged) backfillCoords(db, params.id, [{ id: activityId, locationName }]);
		return { updated: true };
	},

	deleteActivity: async ({ params, request, locals }) => {
		const me = locals.user!;
		const { db, role } = await requireMembership(params.id, me.id);
		const activityId = String((await request.formData()).get('activityId') ?? '');

		const existing = (
			await db
				.select({ proposedBy: activities.proposedBy })
				.from(activities)
				.where(and(eq(activities.id, activityId), eq(activities.tripId, params.id)))
				.limit(1)
		)[0];
		if (!existing) return fail(404, { error: 'Activity not found.' });
		if (existing.proposedBy !== me.id && role !== 'organizer') {
			return fail(403, { error: 'Only the proposer or an organizer can delete this.' });
		}
		await db.delete(activities).where(eq(activities.id, activityId));
		return { deletedActivity: true };
	},

	vote: async ({ params, request, locals }) => {
		const me = locals.user!;
		const { db } = await requireMembership(params.id, me.id);
		const data = await request.formData();
		const activityId = String(data.get('activityId') ?? '');
		const value = Number.parseInt(String(data.get('value') ?? '0'), 10);

		// Confirm the activity belongs to this trip.
		const a = await db
			.select({ id: activities.id })
			.from(activities)
			.where(and(eq(activities.id, activityId), eq(activities.tripId, params.id)))
			.limit(1);
		if (!a[0]) return fail(400, { error: 'Unknown activity.' });

		// Upvote-only: value 1 marks interest, anything else clears it. Votes stay anonymous
		// (only the tally is ever shown), but we still store who voted to prevent double-votes.
		if (value === 1) {
			await db
				.insert(activityVotes)
				.values({ activityId, userId: me.id, value: 1 })
				.onConflictDoUpdate({
					target: [activityVotes.activityId, activityVotes.userId],
					set: { value: 1 }
				});
		} else {
			await db
				.delete(activityVotes)
				.where(and(eq(activityVotes.activityId, activityId), eq(activityVotes.userId, me.id)));
		}
		return { voted: true };
	},

	// Schedule onto a day (date only) or send back to ideas (empty date). New day placements
	// go to the end of that day's list, and land un-done.
	schedule: async ({ params, request, locals }) => {
		const me = locals.user!;
		const { db } = await requireMembership(params.id, me.id);
		const data = await request.formData();
		const activityId = String(data.get('activityId') ?? '');
		const scheduledDate = String(data.get('scheduledDate') ?? '').trim() || null;

		let dayOrder = 0;
		if (scheduledDate) {
			const sameDay = await db
				.select({ dayOrder: activities.dayOrder })
				.from(activities)
				.where(and(eq(activities.tripId, params.id), eq(activities.scheduledDate, scheduledDate)));
			dayOrder = sameDay.reduce((max, r) => Math.max(max, r.dayOrder + 1), 0);
		}

		await db
			.update(activities)
			.set({ scheduledDate, dayOrder, done: false })
			.where(and(eq(activities.id, activityId), eq(activities.tripId, params.id)));

		return { scheduled: true };
	},

	// Mark a scheduled activity done / not done (stays in the plan, just de-emphasised).
	toggleDone: async ({ params, request, locals }) => {
		const me = locals.user!;
		const { db } = await requireMembership(params.id, me.id);
		const data = await request.formData();
		const activityId = String(data.get('activityId') ?? '');
		const done = String(data.get('done') ?? '') === 'true';
		await db
			.update(activities)
			.set({ done })
			.where(and(eq(activities.id, activityId), eq(activities.tripId, params.id)));
		return { doneToggled: true };
	},

	// Persist a new manual order for one day (drag-and-drop). `ids` is the ordered list.
	reorderDay: async ({ params, request, locals }) => {
		const me = locals.user!;
		const { db } = await requireMembership(params.id, me.id);
		const data = await request.formData();
		const scheduledDate = String(data.get('scheduledDate') ?? '').trim();
		const ids = data.getAll('ids').map(String);
		if (!scheduledDate || ids.length === 0) return fail(400, { error: 'Nothing to reorder.' });

		for (let i = 0; i < ids.length; i++) {
			await db
				.update(activities)
				.set({ dayOrder: i })
				.where(
					and(
						eq(activities.id, ids[i]),
						eq(activities.tripId, params.id),
						eq(activities.scheduledDate, scheduledDate)
					)
				);
		}
		return { reordered: true };
	},

	updateTrip: async ({ params, request, locals }) => {
		const me = locals.user!;
		const { db, role } = await requireMembership(params.id, me.id);
		if (role !== 'organizer') return fail(403, { settingsError: 'Only an organizer can edit the trip.' });

		const data = await request.formData();
		const name = String(data.get('name') ?? '').trim();
		if (!name) return fail(400, { settingsError: 'Enter a destination.' });
		const startDate = String(data.get('startDate') ?? '').trim() || null;
		const endDate = String(data.get('endDate') ?? '').trim() || null;
		if (startDate && endDate && endDate < startDate) {
			return fail(400, { settingsError: 'End date is before the start date.' });
		}

		const existing = (
			await db
				.select({
					accommodationName: trips.accommodationName,
					accommodationLat: trips.accommodationLat,
					accommodationLng: trips.accommodationLng
				})
				.from(trips)
				.where(eq(trips.id, params.id))
				.limit(1)
		)[0];

		const accommodationName = String(data.get('accommodationName') ?? '').trim() || null;
		let accommodationLat = existing?.accommodationLat ?? null;
		let accommodationLng = existing?.accommodationLng ?? null;
		if (!accommodationName) {
			accommodationLat = null;
			accommodationLng = null;
		} else if (accommodationName !== existing?.accommodationName) {
			const geo = await geocodeForTrip(db, params.id, accommodationName);
			accommodationLat = geo?.lat ?? null;
			accommodationLng = geo?.lng ?? null;
		}

		await db
			.update(trips)
			.set({ name, startDate, endDate, accommodationName, accommodationLat, accommodationLng })
			.where(eq(trips.id, params.id));
		return { tripUpdated: true };
	},

	deleteTrip: async ({ params, locals }) => {
		const me = locals.user!;
		const { db, role } = await requireMembership(params.id, me.id);
		if (role !== 'organizer') {
			return fail(403, { settingsError: 'Only an organizer can delete the trip.' });
		}
		await db.delete(trips).where(eq(trips.id, params.id)); // cascades to all trip data
		throw redirect(303, '/trips');
	},

	leaveTrip: async ({ params, locals }) => {
		const me = locals.user!;
		const { db, role } = await requireMembership(params.id, me.id);

		if (role === 'organizer') {
			const orgs = await db
				.select({ userId: tripMembers.userId })
				.from(tripMembers)
				.where(and(eq(tripMembers.tripId, params.id), eq(tripMembers.role, 'organizer')));
			if (orgs.length <= 1) {
				return fail(400, {
					settingsError: 'You are the only organizer — delete the trip or make someone else an organizer first.'
				});
			}
		}

		await db
			.delete(tripMembers)
			.where(and(eq(tripMembers.tripId, params.id), eq(tripMembers.userId, me.id)));
		throw redirect(303, '/trips');
	}
};
