import { fail, redirect } from '@sveltejs/kit';
import { desc, eq, sql } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { trips, tripMembers } from '$lib/server/db/schema';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user!;
	const db = await getDb();

	const memberCount = db
		.select({ tripId: tripMembers.tripId, count: sql<number>`count(*)::int`.as('count') })
		.from(tripMembers)
		.groupBy(tripMembers.tripId)
		.as('member_count');

	const rows = await db
		.select({
			id: trips.id,
			name: trips.name,
			destination: trips.destination,
			startDate: trips.startDate,
			endDate: trips.endDate,
			status: trips.status,
			role: tripMembers.role,
			members: sql<number>`coalesce(${memberCount.count}, 1)`
		})
		.from(tripMembers)
		.innerJoin(trips, eq(tripMembers.tripId, trips.id))
		.leftJoin(memberCount, eq(memberCount.tripId, trips.id))
		.where(eq(tripMembers.userId, user.id))
		.orderBy(desc(trips.createdAt));

	return { trips: rows };
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const user = locals.user!;
		const data = await request.formData();
		const name = String(data.get('name') ?? '').trim();
		const destination = String(data.get('destination') ?? '').trim() || null;
		const startDate = String(data.get('startDate') ?? '').trim() || null;
		const endDate = String(data.get('endDate') ?? '').trim() || null;

		if (!name) return fail(400, { error: 'Give your trip a name.' });
		if (startDate && endDate && endDate < startDate) {
			return fail(400, { error: 'End date is before the start date.' });
		}

		const db = await getDb();
		const inserted = await db
			.insert(trips)
			.values({ name, destination, startDate, endDate, createdBy: user.id })
			.returning({ id: trips.id });

		await db
			.insert(tripMembers)
			.values({ tripId: inserted[0].id, userId: user.id, role: 'organizer' });

		throw redirect(303, `/trips/${inserted[0].id}`);
	}
};
