import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { eq } from 'drizzle-orm';
import type { Cookies } from '@sveltejs/kit';
import { getDb } from './db';
import { sessions, users, type User } from './db/schema';

const scryptAsync = promisify(scrypt);

const SESSION_COOKIE = 'wander_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

// --- Passwords ----------------------------------------------------------------

export async function hashPassword(password: string): Promise<string> {
	const salt = randomBytes(16).toString('hex');
	const derived = (await scryptAsync(password, salt, 64)) as Buffer;
	return `${salt}:${derived.toString('hex')}`;
}

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
	const [salt, key] = stored.split(':');
	if (!salt || !key) return false;
	const derived = (await scryptAsync(password, salt, 64)) as Buffer;
	const keyBuf = Buffer.from(key, 'hex');
	return keyBuf.length === derived.length && timingSafeEqual(keyBuf, derived);
}

// --- Sessions -----------------------------------------------------------------

export async function createSession(userId: string, cookies: Cookies): Promise<void> {
	const db = await getDb();
	const id = randomBytes(32).toString('hex');
	const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
	await db.insert(sessions).values({ id, userId, expiresAt });
	cookies.set(SESSION_COOKIE, id, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production',
		expires: expiresAt
	});
}

export async function destroySession(cookies: Cookies): Promise<void> {
	const id = cookies.get(SESSION_COOKIE);
	if (id) {
		const db = await getDb();
		await db.delete(sessions).where(eq(sessions.id, id));
	}
	cookies.delete(SESSION_COOKIE, { path: '/' });
}

export type SessionUser = Pick<User, 'id' | 'name'>;

export async function getUserFromCookies(cookies: Cookies): Promise<SessionUser | null> {
	const id = cookies.get(SESSION_COOKIE);
	if (!id) return null;

	const db = await getDb();
	const row = await db
		.select({
			session: sessions,
			user: { id: users.id, name: users.name }
		})
		.from(sessions)
		.innerJoin(users, eq(sessions.userId, users.id))
		.where(eq(sessions.id, id))
		.limit(1);

	const found = row[0];
	if (!found) return null;

	if (found.session.expiresAt.getTime() < Date.now()) {
		await db.delete(sessions).where(eq(sessions.id, id));
		cookies.delete(SESSION_COOKIE, { path: '/' });
		return null;
	}

	return found.user;
}
