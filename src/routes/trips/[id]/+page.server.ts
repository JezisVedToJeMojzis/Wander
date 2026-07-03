import { error, fail, redirect } from '@sveltejs/kit';
import { randomBytes } from 'node:crypto';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import {
	activities,
	activityVotes,
	friendships,
	routeGroups,
	routeGroupItems,
	tripInvites,
	tripMembers,
	trips,
	users
} from '$lib/server/db/schema';
import { geocode } from '$lib/server/geocode';
import { buildRoute } from '$lib/route';
import { assembleScope, sortGroups, type Decorated, type GroupRow } from '$lib/server/route-view';
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

// owner_id for a scope: null = shared with the trip, my id = personal.
const ownerForScope = (scope: string, meId: string): string | null =>
	scope === 'shared' ? null : meId;

async function scopeGroupIds(
	db: Awaited<ReturnType<typeof getDb>>,
	tripId: string,
	ownerId: string | null
): Promise<string[]> {
	const where =
		ownerId === null
			? and(eq(routeGroups.tripId, tripId), isNull(routeGroups.ownerId))
			: and(eq(routeGroups.tripId, tripId), eq(routeGroups.ownerId, ownerId));
	const rows = await db.select({ id: routeGroups.id }).from(routeGroups).where(where);
	return rows.map((r) => r.id);
}

// Geocode a place using the trip's destination (its name) as a disambiguating hint,
// so short inputs like "Colosseum" resolve to the right city.
async function geocodeForTrip(
	db: Awaited<ReturnType<typeof getDb>>,
	tripId: string,
	locationName: string
) {
	const trip = (await db.select({ name: trips.name }).from(trips).where(eq(trips.id, tripId)).limit(1))[0];
	const query = trip?.name ? `${locationName}, ${trip.name}` : locationName;
	return geocode(query);
}

const addDaysISO = (iso: string, days: number): string => {
	const d = new Date(iso + 'T00:00:00Z');
	d.setUTCDate(d.getUTCDate() + days);
	return d.toISOString().slice(0, 10);
};
const dayCountInclusive = (start: string, end: string): number => {
	const a = new Date(start + 'T00:00:00Z').getTime();
	const b = new Date(end + 'T00:00:00Z').getTime();
	return Math.max(1, Math.round((b - a) / 86400000) + 1);
};

export const load: PageServerLoad = async ({ params, locals }) => {
	const me = locals.user!;
	const { db, role } = await requireMembership(params.id, me.id);

	const tripRow = await db.select().from(trips).where(eq(trips.id, params.id)).limit(1);
	const trip = tripRow[0];
	if (!trip) throw error(404, 'Trip not found.');

	// Members + my friendship status toward each of them.
	const memberRows = await db
		.select({
			id: users.id,
			name: users.name,
			role: tripMembers.role
		})
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

	// Activities + vote tallies.
	const acts = await db.select().from(activities).where(eq(activities.tripId, params.id));
	const actIds = acts.map((a) => a.id);
	const allVotes = actIds.length
		? await db.select().from(activityVotes).where(inArray(activityVotes.activityId, actIds))
		: [];

	const nameById = new Map(memberRows.map((m) => [m.id, m.name]));
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
		return { ...a, score, up, myVote, interestedNames, proposedByName, canEdit };
	});

	const pool = decorated
		.filter((a) => !a.scheduledDate)
		.sort((a, b) => b.score - a.score || b.up - a.up);

	const scheduled = decorated
		.filter((a) => a.scheduledDate)
		.sort(
			(a, b) =>
				(a.scheduledDate! < b.scheduledDate! ? -1 : a.scheduledDate! > b.scheduledDate! ? 1 : 0) ||
				(a.startTime ?? '').localeCompare(b.startTime ?? '')
		);

	// ---- Route + grouping ----------------------------------------------------
	// Backfill missing coordinates by geocoding the location name (then persist so we
	// don't re-query on every visit). Best-effort: failures just leave the place out.
	for (const a of decorated) {
		if ((!a.lat || !a.lng) && a.locationName) {
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

	const toDecorated = (a: (typeof decorated)[number]): Decorated => ({
		id: a.id,
		title: a.title,
		score: a.score,
		category: a.category,
		locationName: a.locationName,
		lat: a.lat,
		lng: a.lng
	});
	const allById = new Map(decorated.map((a) => [a.id, toDecorated(a)]));

	// "Mine" = places I added or upvoted. "Shared" = all of the trip's activities.
	const candidatesMine = decorated
		.filter((a) => a.proposedBy === me.id || a.myVote === 1)
		.map(toDecorated);
	const candidatesShared = decorated.map(toDecorated);

	const allGroups = await db.select().from(routeGroups).where(eq(routeGroups.tripId, params.id));
	const groupIds = allGroups.map((g) => g.id);
	const allItems = groupIds.length
		? await db.select().from(routeGroupItems).where(inArray(routeGroupItems.groupId, groupIds))
		: [];
	const itemsByGroup = new Map<string, string[]>();
	for (const it of allItems) {
		const list = itemsByGroup.get(it.groupId) ?? [];
		list.push(it.activityId);
		itemsByGroup.set(it.groupId, list);
	}
	const toGroupRow = (g: (typeof allGroups)[number]): GroupRow & { position: number } => ({
		id: g.id,
		name: g.name,
		kind: g.kind,
		dayDate: g.dayDate,
		position: g.position
	});
	const mineGroups = sortGroups(allGroups.filter((g) => g.ownerId === me.id).map(toGroupRow));
	const sharedGroups = sortGroups(allGroups.filter((g) => g.ownerId === null).map(toGroupRow));

	const routeView = {
		mine: assembleScope(candidatesMine, mineGroups, itemsByGroup, allById),
		shared: assembleScope(candidatesShared, sharedGroups, itemsByGroup, allById)
	};

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
		scheduled,
		inviteToken: invite.token,
		canLeave,
		routeView
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

	schedule: async ({ params, request, locals }) => {
		const me = locals.user!;
		const { db } = await requireMembership(params.id, me.id);
		const data = await request.formData();
		const activityId = String(data.get('activityId') ?? '');
		const scheduledDate = String(data.get('scheduledDate') ?? '').trim() || null;
		const startTime = String(data.get('startTime') ?? '').trim() || null;
		const durationRaw = String(data.get('durationMin') ?? '').trim();
		const durationMin = durationRaw ? Number.parseInt(durationRaw, 10) : null;

		await db
			.update(activities)
			.set({
				scheduledDate,
				startTime: scheduledDate ? startTime : null,
				durationMin: scheduledDate && Number.isFinite(durationMin) ? durationMin : null
			})
			.where(and(eq(activities.id, activityId), eq(activities.tripId, params.id)));

		return { scheduled: true };
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

		await db
			.update(trips)
			.set({ name, startDate, endDate })
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
		// Drop my personal route groups for this trip (shared ones stay).
		await db
			.delete(routeGroups)
			.where(and(eq(routeGroups.tripId, params.id), eq(routeGroups.ownerId, me.id)));
		throw redirect(303, '/trips');
	},

	createGroup: async ({ params, request, locals }) => {
		const me = locals.user!;
		const { db } = await requireMembership(params.id, me.id);
		const data = await request.formData();
		const name = String(data.get('name') ?? '').trim();
		const scope = String(data.get('scope') ?? 'mine');
		if (!name) return fail(400, { error: 'Name the group.' });

		const ownerId = ownerForScope(scope, me.id);
		const siblings = await scopeGroupIds(db, params.id, ownerId);
		await db.insert(routeGroups).values({
			tripId: params.id,
			ownerId,
			name,
			kind: 'custom',
			position: siblings.length
		});
		return { groupCreated: true };
	},

	deleteGroup: async ({ params, request, locals }) => {
		const me = locals.user!;
		const { db } = await requireMembership(params.id, me.id);
		const groupId = String((await request.formData()).get('groupId') ?? '');

		const g = (
			await db.select().from(routeGroups).where(eq(routeGroups.id, groupId)).limit(1)
		)[0];
		// Only the owner may delete a personal group; any member may delete a shared one.
		if (!g || g.tripId !== params.id || (g.ownerId !== null && g.ownerId !== me.id)) {
			return fail(403, { error: 'Cannot delete that group.' });
		}
		await db.delete(routeGroups).where(eq(routeGroups.id, groupId));
		return { groupDeleted: true };
	},

	// Move a stop to a group (target = group id) or out of any group (target = 'none').
	moveItem: async ({ params, request, locals }) => {
		const me = locals.user!;
		const { db } = await requireMembership(params.id, me.id);
		const data = await request.formData();
		const activityId = String(data.get('activityId') ?? '');
		const target = String(data.get('target') ?? 'none');
		const scope = String(data.get('scope') ?? 'mine');

		let ownerId: string | null;
		if (target !== 'none') {
			const g = (
				await db.select().from(routeGroups).where(eq(routeGroups.id, target)).limit(1)
			)[0];
			if (!g || g.tripId !== params.id || (g.ownerId !== null && g.ownerId !== me.id)) {
				return fail(403, { error: 'Cannot edit that group.' });
			}
			ownerId = g.ownerId;
		} else {
			ownerId = ownerForScope(scope, me.id);
		}

		// A stop sits in at most one group per scope, so clear any sibling assignment first.
		const siblings = await scopeGroupIds(db, params.id, ownerId);
		if (siblings.length) {
			await db
				.delete(routeGroupItems)
				.where(
					and(
						eq(routeGroupItems.activityId, activityId),
						inArray(routeGroupItems.groupId, siblings)
					)
				);
		}
		if (target !== 'none') {
			await db
				.insert(routeGroupItems)
				.values({ groupId: target, activityId })
				.onConflictDoNothing();
		}
		return { itemMoved: true };
	},

	autoSplitDays: async ({ params, request, locals }) => {
		const me = locals.user!;
		const { db } = await requireMembership(params.id, me.id);
		const scope = String((await request.formData()).get('scope') ?? 'mine');
		const ownerId = ownerForScope(scope, me.id);

		const trip = (await db.select().from(trips).where(eq(trips.id, params.id)).limit(1))[0];

		// Recompute the candidate set + proximity order for this scope.
		const acts = await db.select().from(activities).where(eq(activities.tripId, params.id));
		const actIds = acts.map((a) => a.id);
		const votes = actIds.length
			? await db.select().from(activityVotes).where(inArray(activityVotes.activityId, actIds))
			: [];
		const scoreOf = (id: string) =>
			votes.filter((v) => v.activityId === id).reduce((s, v) => s + v.value, 0);
		const myVoteOf = (id: string) =>
			votes.find((v) => v.activityId === id && v.userId === me.id)?.value ?? 0;

		const candidates = acts.filter((a) =>
			scope === 'shared' ? true : a.proposedBy === me.id || myVoteOf(a.id) === 1
		);
		const coordCands = candidates.filter(
			(a) => a.lat && a.lng && Number.isFinite(Number(a.lat)) && Number.isFinite(Number(a.lng))
		);
		const ordered = buildRoute(
			coordCands.map((a) => ({
				id: a.id,
				title: a.title,
				score: scoreOf(a.id),
				lat: Number(a.lat),
				lng: Number(a.lng)
			}))
		).stops.map((s) => s.id);

		// Replace existing day groups in this scope (custom groups are left alone).
		const existing = await db
			.select()
			.from(routeGroups)
			.where(
				and(
					eq(routeGroups.tripId, params.id),
					eq(routeGroups.kind, 'day'),
					ownerId === null ? isNull(routeGroups.ownerId) : eq(routeGroups.ownerId, ownerId)
				)
			);
		if (existing.length) {
			await db.delete(routeGroups).where(
				inArray(
					routeGroups.id,
					existing.map((g) => g.id)
				)
			);
		}

		if (ordered.length === 0) return { split: true };

		const numDays =
			trip?.startDate && trip?.endDate
				? dayCountInclusive(trip.startDate, trip.endDate)
				: Math.max(1, Math.ceil(ordered.length / 4));
		const perDay = Math.ceil(ordered.length / numDays);

		for (let d = 0; d < numDays; d++) {
			const chunk = ordered.slice(d * perDay, (d + 1) * perDay);
			if (chunk.length === 0) continue;
			const dayDate = trip?.startDate ? addDaysISO(trip.startDate, d) : null;
			const created = (
				await db
					.insert(routeGroups)
					.values({
						tripId: params.id,
						ownerId,
						name: `Day ${d + 1}`,
						kind: 'day',
						dayDate,
						position: d
					})
					.returning({ id: routeGroups.id })
			)[0];
			await db
				.insert(routeGroupItems)
				.values(chunk.map((activityId) => ({ groupId: created.id, activityId })));
		}
		return { split: true };
	}
};
