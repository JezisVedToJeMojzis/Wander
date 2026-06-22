import { redirect, type Handle } from '@sveltejs/kit';
import { getUserFromCookies } from '$lib/server/auth';

// Routes reachable without a session.
const PUBLIC_PREFIXES = ['/login', '/register'];

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.user = await getUserFromCookies(event.cookies);

	const { pathname } = event.url;
	const isPublic = PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'));
	// Invite links must be reachable logged-out so they can redirect to register.
	const isInvite = pathname.startsWith('/join/');

	if (!event.locals.user && !isPublic && !isInvite) {
		throw redirect(303, `/login?next=${encodeURIComponent(pathname)}`);
	}

	return resolve(event);
};
