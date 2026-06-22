import { fail } from '@sveltejs/kit';
import { aliasedTable, and, eq, or } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { friendships, users } from '$lib/server/db/schema';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const me = locals.user!;
	const db = await getDb();

	const requester = aliasedTable(users, 'requester');
	const addressee = aliasedTable(users, 'addressee');

	const rows = await db
		.select({
			id: friendships.id,
			status: friendships.status,
			requesterId: friendships.requesterId,
			requesterName: requester.name,
			addresseeId: friendships.addresseeId,
			addresseeName: addressee.name
		})
		.from(friendships)
		.innerJoin(requester, eq(friendships.requesterId, requester.id))
		.innerJoin(addressee, eq(friendships.addresseeId, addressee.id))
		.where(or(eq(friendships.requesterId, me.id), eq(friendships.addresseeId, me.id)));

	const friends = rows
		.filter((r) => r.status === 'accepted')
		.map((r) => (r.requesterId === me.id ? { name: r.addresseeName } : { name: r.requesterName }));

	const incoming = rows
		.filter((r) => r.status === 'pending' && r.addresseeId === me.id)
		.map((r) => ({ id: r.id, name: r.requesterName }));

	const outgoing = rows
		.filter((r) => r.status === 'pending' && r.requesterId === me.id)
		.map((r) => ({ name: r.addresseeName }));

	return { friends, incoming, outgoing };
};

export const actions: Actions = {
	accept: async ({ request, locals }) => {
		const me = locals.user!;
		const db = await getDb();
		const id = String((await request.formData()).get('id') ?? '');
		// Only the addressee can accept.
		const updated = await db
			.update(friendships)
			.set({ status: 'accepted' })
			.where(and(eq(friendships.id, id), eq(friendships.addresseeId, me.id)))
			.returning({ id: friendships.id });
		if (!updated[0]) return fail(400, { error: 'Could not accept request.' });
		return { ok: true };
	}
};
