import { error, fail, redirect } from '@sveltejs/kit';
import { randomBytes } from 'node:crypto';
import { and, eq, inArray, or } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import {
	activities,
	activityVotes,
	friendships,
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

export const load: PageServerLoad = async ({ params, locals }) => {
	const me = locals.user!;
	const { db, role } = await requireMembership(params.id, me.id);

	const tripRow = await db.select().from(trips).where(eq(trips.id, params.id)).limit(1);
	const trip = tripRow[0];
	if (!trip) throw error(404, 'Trip not found.');

	// Members + my friendship status toward each of them.
	const memberRows = await db
		.select({ id: users.id, name: users.name, role: tripMembers.role })
		.from(tripMembers)
		.innerJoin(users, eq(tripMembers.userId, users.id))
		.where(eq(tripMembers.tripId, params.id));

	const myFriendships = await db
		.select()
		.from(friendships)
		.where(or(eq(friendships.requesterId, me.id), eq(friendships.addresseeId, me.id)));

	const friendStatusFor = (otherId: string): 'self' | 'accepted' | 'sent' | 'received' | 'none' => {
		if (otherId === me.id) return 'self';
		const f = myFriendships.find(
			(x) =>
				(x.requesterId === me.id && x.addresseeId === otherId) ||
				(x.requesterId === otherId && x.addresseeId === me.id)
		);
		if (!f) return 'none';
		if (f.status === 'accepted') return 'accepted';
		return f.requesterId === me.id ? 'sent' : 'received';
	};

	const members = memberRows.map((m) => ({ ...m, friendStatus: friendStatusFor(m.id) }));

	// You can leave unless you're the sole organizer (then you must delete or hand off).
	const organizerCount = members.filter((m) => m.role === 'organizer').length;
	const canLeave = !(role === 'organizer' && organizerCount === 1);

	// Friends I could invite straight into this trip = my accepted friends not already members.
	const memberIds = new Set(memberRows.map((m) => m.id));
	const acceptedFriendIds = myFriendships
		.filter((f) => f.status === 'accepted')
		.map((f) => (f.requesterId === me.id ? f.addresseeId : f.requesterId))
		.filter((id) => !memberIds.has(id));
	const invitableFriends = acceptedFriendIds.length
		? await db
				.select({ id: users.id, name: users.name })
				.from(users)
				.where(inArray(users.id, acceptedFriendIds))
		: [];

	// Activities + vote tallies.
	const acts = await db.select().from(activities).where(eq(activities.tripId, params.id));
	const actIds = acts.map((a) => a.id);
	const allVotes = actIds.length
		? await db.select().from(activityVotes).where(inArray(activityVotes.activityId, actIds))
		: [];

	// Backfill any missing coordinates by geocoding the location name (then persist, so we
	// don't re-query on every visit). Best-effort: failures just leave the place uncoordinated.
	for (const a of acts) {
		if (!hasCoords(a) && a.locationName) {
			const geo = await geocode(a.locationName);
			if (geo) {
				a.lat = geo.lat;
				a.lng = geo.lng;
				await db
					.update(activities)
					.set({ lat: geo.lat, lng: geo.lng })
					.where(eq(activities.id, a.id));
			}
		}
	}

	const nameById = new Map(memberRows.map((m) => [m.id, m.name]));
	const catOf = new Map(acts.map((a) => [a.id, a.category]));
	const titleOf = new Map(acts.map((a) => [a.id, a.title]));

	// Precompute, for each coordinate-bearing place, the 5 nearest other places (added to
	// this trip) with their distance — used by the "Nearby" helper in the Activities tab.
	const coordActs = acts.filter(hasCoords).map((a) => ({ id: a.id, lat: Number(a.lat), lng: Number(a.lng) }));
	const nearbyFor = (a: (typeof acts)[number]) => {
		if (!hasCoords(a)) return [];
		const from = { lat: Number(a.lat), lng: Number(a.lng) };
		return coordActs
			.filter((o) => o.id !== a.id)
			.map((o) => ({ id: o.id, title: titleOf.get(o.id)!, category: catOf.get(o.id)!, km: haversineKm(from, o) }))
			.sort((x, y) => x.km - y.km)
			.slice(0, 5);
	};

	const decorated = acts.map((a) => {
		const votes = allVotes.filter((v) => v.activityId === a.id);
		const score = votes.reduce((s, v) => s + v.value, 0);
		const up = votes.filter((v) => v.value === 1).length;
		const myVote = votes.find((v) => v.userId === me.id)?.value ?? 0;
		const interestedNames = votes
			.filter((v) => v.value === 1)
			.map((v) => (v.userId === me.id ? 'You' : (nameById.get(v.userId) ?? 'Someone')));
		const proposedByName =
			a.proposedBy === me.id ? 'You' : (nameById.get(a.proposedBy) ?? 'Someone');
		const canEdit = a.proposedBy === me.id || role === 'organizer';
		return { ...a, score, up, myVote, interestedNames, proposedByName, canEdit, nearby: nearbyFor(a) };
	});

	const pool = decorated
		.filter((a) => !a.scheduledDate)
		.sort((a, b) => b.score - a.score || b.up - a.up);

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
		.map(([date, items]) => {
			const routePoints = items.filter(hasCoords).map((a) => ({ lat: a.lat!, lng: a.lng! }));
			return {
				date,
				items,
				mapsUrl: googleMapsDirectionsUrl(routePoints),
				total: items.reduce((s, a) => s + (a.estCost ?? 0), 0)
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
		invitableFriends,
		pool,
		days,
		scheduledCount: scheduledActs.length,
		inviteToken: invite.token,
		canLeave
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

		// Geocode the location up front so it can join routes right away (best-effort).
		const geo = await geocodeForTrip(db, params.id, locationName);

		await db.insert(activities).values({
			tripId: params.id,
			title,
			category: category as never,
			locationName,
			lat: geo?.lat ?? null,
			lng: geo?.lng ?? null,
			notes: String(data.get('notes') ?? '').trim() || null,
			estCost: Number.isFinite(estCost) ? estCost : null,
			proposedBy: me.id
		});

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

		// Re-geocode only when the location text actually changed.
		let lat = existing.lat;
		let lng = existing.lng;
		if (locationName !== existing.locationName) {
			const geo = await geocodeForTrip(db, params.id, locationName);
			lat = geo?.lat ?? null;
			lng = geo?.lng ?? null;
		}

		await db
			.update(activities)
			.set({
				title,
				category: category as never,
				locationName,
				lat,
				lng,
				notes: String(data.get('notes') ?? '').trim() || null,
				estCost: Number.isFinite(estCost) ? estCost : null
			})
			.where(eq(activities.id, activityId));
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

		// Upvote-only: value 1 marks interest, anything else clears it.
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
	// go to the end of that day's list.
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
			.set({ scheduledDate, dayOrder })
			.where(and(eq(activities.id, activityId), eq(activities.tripId, params.id)));

		return { scheduled: true };
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

	addFriend: async ({ params, request, locals }) => {
		const me = locals.user!;
		await requireMembership(params.id, me.id);
		const db = await getDb();
		const data = await request.formData();
		const targetId = String(data.get('targetId') ?? '');
		if (!targetId || targetId === me.id) return fail(400, { error: 'Invalid request.' });

		// If they already sent me a request, accept it; otherwise create a pending one.
		const reverse = await db
			.select()
			.from(friendships)
			.where(and(eq(friendships.requesterId, targetId), eq(friendships.addresseeId, me.id)))
			.limit(1);

		if (reverse[0]) {
			await db
				.update(friendships)
				.set({ status: 'accepted' })
				.where(eq(friendships.id, reverse[0].id));
		} else {
			await db
				.insert(friendships)
				.values({ requesterId: me.id, addresseeId: targetId })
				.onConflictDoNothing();
		}
		return { friended: true };
	},

	// Add one of my accepted friends straight into this trip as a member.
	inviteFriend: async ({ params, request, locals }) => {
		const me = locals.user!;
		await requireMembership(params.id, me.id);
		const db = await getDb();
		const targetId = String((await request.formData()).get('targetId') ?? '');
		if (!targetId || targetId === me.id) return fail(400, { error: 'Invalid request.' });

		// Must actually be my accepted friend.
		const friend = await db
			.select({ id: friendships.id })
			.from(friendships)
			.where(
				and(
					eq(friendships.status, 'accepted'),
					or(
						and(eq(friendships.requesterId, me.id), eq(friendships.addresseeId, targetId)),
						and(eq(friendships.requesterId, targetId), eq(friendships.addresseeId, me.id))
					)
				)
			)
			.limit(1);
		if (!friend[0]) return fail(403, { error: 'You can only invite your friends.' });

		await db
			.insert(tripMembers)
			.values({ tripId: params.id, userId: targetId, role: 'member' })
			.onConflictDoNothing();
		return { invited: true };
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

		await db.update(trips).set({ name, startDate, endDate }).where(eq(trips.id, params.id));
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
