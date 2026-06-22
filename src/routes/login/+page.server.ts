import { fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { users } from '$lib/server/db/schema';
import { createSession, verifyPassword } from '$lib/server/auth';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.user) throw redirect(303, '/trips');
};

export const actions: Actions = {
	default: async ({ request, cookies, url }) => {
		const form = await request.formData();
		const email = String(form.get('email') ?? '')
			.trim()
			.toLowerCase();
		const password = String(form.get('password') ?? '');

		if (!email || !password) {
			return fail(400, { email, error: 'Enter your email and password.' });
		}

		const db = await getDb();
		const found = await db.select().from(users).where(eq(users.email, email)).limit(1);
		const user = found[0];

		if (!user || !(await verifyPassword(user.passwordHash, password))) {
			return fail(400, { email, error: 'Incorrect email or password.' });
		}

		await createSession(user.id, cookies);
		const next = url.searchParams.get('next');
		throw redirect(303, next && next.startsWith('/') ? next : '/trips');
	}
};
