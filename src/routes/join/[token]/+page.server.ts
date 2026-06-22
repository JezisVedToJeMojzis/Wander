import { error, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { tripInvites, tripMembers } from '$lib/server/db/schema';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	const db = await getDb();
	const invite = (
		await db.select().from(tripInvites).where(eq(tripInvites.token, params.token)).limit(1)
	)[0];
	if (!invite) throw error(404, 'This invite link is invalid or has expired.');

	// Not logged in → send them to register, then back to this link.
	if (!locals.user) {
		throw redirect(303, `/register?next=/join/${params.token}`);
	}

	await db
		.insert(tripMembers)
		.values({ tripId: invite.tripId, userId: locals.user.id, role: 'member' })
		.onConflictDoNothing();

	throw redirect(303, `/trips/${invite.tripId}`);
};
