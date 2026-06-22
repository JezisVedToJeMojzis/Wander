import { mkdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { env } from '$env/dynamic/private';
import * as schema from './schema';

type DB = PgliteDatabase<typeof schema>;

// PGlite is an in-process, single-connection Postgres. During dev the module can
// be re-evaluated by HMR, so we cache the instance on globalThis to avoid opening
// the data directory twice.
const globalForDb = globalThis as unknown as { __wanderDb?: Promise<DB> };

async function init(): Promise<DB> {
	const dataDir = env.DATABASE_DIR || './.data/pgdata';
	// PGlite's mkdir isn't recursive, so make sure the full path exists first.
	mkdirSync(dataDir, { recursive: true });
	const client = new PGlite(dataDir);
	const db = drizzle(client, { schema });
	await migrate(db, { migrationsFolder: './drizzle' });
	return db;
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
