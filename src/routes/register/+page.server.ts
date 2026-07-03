import { fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { users } from '$lib/server/db/schema';
import { createSession, hashPassword } from '$lib/server/auth';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.user) throw redirect(303, '/trips');
};

export const actions: Actions = {
	default: async ({ request, cookies, url }) => {
		const data = await request.formData();
		const name = String(data.get('name') ?? '').trim();
		const password = String(data.get('password') ?? '');

		if (!name || !password) {
			return fail(400, { name, error: 'Name and password are required.' });
		}
		if (password.length < 8) {
			return fail(400, { name, error: 'Password must be at least 8 characters.' });
		}

		const db = await getDb();
		const existing = await db.select({ id: users.id }).from(users).where(eq(users.name, name)).limit(1);
		if (existing[0]) {
			return fail(400, { name, error: 'That name is taken — pick another.' });
		}

		const passwordHash = await hashPassword(password);
		const inserted = await db
			.insert(users)
			.values({ name, passwordHash })
			.returning({ id: users.id });

		await createSession(inserted[0].id, cookies);
		const next = url.searchParams.get('next');
		throw redirect(303, next && next.startsWith('/') ? next : '/trips');
	}
};
