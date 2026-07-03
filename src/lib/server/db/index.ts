import { env } from '$env/dynamic/private';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import * as schema from './schema';

// Both drivers expose the same Drizzle query API, so we type everything as the
// PGlite variant and cast the postgres-js one. Drivers are imported dynamically so
// only the one we actually use is loaded at runtime.
type DB = PgliteDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { __wanderDb?: Promise<DB> };

// Production: a real Postgres (e.g. Neon) via DATABASE_URL.
async function initPostgres(url: string): Promise<DB> {
	const { default: postgres } = await import('postgres');
	const { drizzle } = await import('drizzle-orm/postgres-js');
	const { migrate } = await import('drizzle-orm/postgres-js/migrator');
	// Neon's pooled endpoint runs PgBouncer in transaction mode, which doesn't
	// support prepared statements — disable them so it works either way.
	const client = postgres(url, { prepare: false });
	const db = drizzle(client, { schema });
	await migrate(db, { migrationsFolder: './drizzle' });
	return db as unknown as DB;
}

// Local dev: PGlite (Postgres-in-WASM) persisted to a directory. No setup needed.
async function initPglite(): Promise<DB> {
	const { mkdirSync } = await import('node:fs');
	const { PGlite } = await import('@electric-sql/pglite');
	const { drizzle } = await import('drizzle-orm/pglite');
	const { migrate } = await import('drizzle-orm/pglite/migrator');
	const dataDir = env.DATABASE_DIR || './.data/pgdata';
	// PGlite's mkdir isn't recursive, so make sure the full path exists first.
	mkdirSync(dataDir, { recursive: true });
	const client = new PGlite(dataDir);
	const db = drizzle(client, { schema });
	await migrate(db, { migrationsFolder: './drizzle' });
	return db;
}

function init(): Promise<DB> {
	return env.DATABASE_URL ? initPostgres(env.DATABASE_URL) : initPglite();
}

export function getDb(): Promise<DB> {
	if (!globalForDb.__wanderDb) {
		// Don't cache a rejected promise — a failed init would otherwise wedge the app.
		globalForDb.__wanderDb = init().catch((err) => {
			globalForDb.__wanderDb = undefined;
			throw err;
		});
	}
	return globalForDb.__wanderDb;
}
