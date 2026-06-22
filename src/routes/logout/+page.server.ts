import { redirect } from '@sveltejs/kit';
import { destroySession } from '$lib/server/auth';
import type { Actions } from './$types';

export const actions: Actions = {
	default: async ({ cookies }) => {
		await destroySession(cookies);
		throw redirect(303, '/login');
	}
};
