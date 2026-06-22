import { defineConfig } from 'drizzle-kit';

// We only use drizzle-kit to *generate* SQL migrations from the schema.
// Migrations are applied at runtime against PGlite (see src/lib/server/db/index.ts).
export default defineConfig({
	schema: './src/lib/server/db/schema.ts',
	out: './drizzle',
	dialect: 'postgresql'
});
