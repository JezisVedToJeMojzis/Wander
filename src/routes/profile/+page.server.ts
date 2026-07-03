import { fail } from '@sveltejs/kit';
import { eq, sql } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { tripMembers, users } from '$lib/server/db/schema';
import { hashPassword, verifyPassword } from '$lib/server/auth';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const me = locals.user!;
	const db = await getDb();
	const account = (
		await db
			.select({ name: users.name, createdAt: users.createdAt })
			.from(users)
			.where(eq(users.id, me.id))
			.limit(1)
	)[0];
	const tripCount = (
		await db
			.select({ count: sql<number>`count(*)::int` })
			.from(tripMembers)
			.where(eq(tripMembers.userId, me.id))
	)[0].count;
	return { account, tripCount };
};

export const actions: Actions = {
	updateName: async ({ request, locals }) => {
		const me = locals.user!;
		const name = String((await request.formData()).get('name') ?? '').trim();
		if (!name) return fail(400, { nameError: 'Enter your name.' });
		const db = await getDb();
		await db.update(users).set({ name }).where(eq(users.id, me.id));
		return { nameUpdated: true };
	},

	updatePassword: async ({ request, locals }) => {
		const me = locals.user!;
		const data = await request.formData();
		const current = String(data.get('currentPassword') ?? '');
		const next = String(data.get('newPassword') ?? '');
		if (next.length < 8) return fail(400, { pwError: 'New password must be at least 8 characters.' });

		const db = await getDb();
		const row = (
			await db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, me.id)).limit(1)
		)[0];
		if (!row || !(await verifyPassword(row.passwordHash, current))) {
			return fail(400, { pwError: 'Current password is incorrect.' });
		}
		await db.update(users).set({ passwordHash: await hashPassword(next) }).where(eq(users.id, me.id));
		return { pwUpdated: true };
	}
};
