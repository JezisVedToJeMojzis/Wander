# Wander 🧭

A mobile-first **PWA for planning trips together**. Create a trip, invite friends
(and non-friends) by share link, throw in places & activities, vote on what to do,
and build the day-by-day itinerary — with a one-tap Google Maps link for every place.

A **smart Route** turns the places you added/upvoted into a suggested order (most-voted
first, then nearest-next so it won't make pointless detours), which you can auto-split
into days or organise into your own custom groups — each with its own Google Maps route.

## Stack

- **SvelteKit + TypeScript** — full-stack app (UI + server endpoints in one codebase)
- **Tailwind v4** — mobile-first styling, dark theme
- **PWA** via `@vite-pwa/sveltekit` — installable, offline app shell, home-screen icon
- **PGlite (Postgres in WASM) + Drizzle ORM** — real Postgres semantics, zero native
  build, persists to `./.data`. Swappable to a hosted Postgres (Neon/Render) for prod.
- **Auth** — name + password with session cookies (name is the unique login id, no email);
  passwords hashed with Node `scrypt`.

## Getting started

```bash
npm install
cp .env.example .env      # local PGlite data dir
npm run dev               # http://localhost:5173
```

The database is created and migrated automatically on first run.

## Common commands

```bash
npm run dev               # dev server
npm run build             # production build (adapter-node)
npm run preview           # preview the production build
npm run check             # type-check (svelte-check)

# After changing the schema (src/lib/server/db/schema.ts):
npx drizzle-kit generate  # write a new SQL migration into ./drizzle
```

Migrations in `./drizzle` are applied at startup by `src/lib/server/db/index.ts`.

## How it works

| Area | Where |
|------|-------|
| DB schema | `src/lib/server/db/schema.ts` |
| DB client + auto-migrate | `src/lib/server/db/index.ts` |
| Auth (hash, sessions) | `src/lib/server/auth.ts` |
| Route guard | `src/hooks.server.ts` |
| Google Maps deep links (search + directions) | `src/lib/maps.ts` |
| Route ordering algorithm (votes + proximity) | `src/lib/route.ts` |
| Geocoding (place name → coordinates) | `src/lib/server/geocode.ts` |
| Grouped-route assembly | `src/lib/server/route-view.ts` |
| Trips list / create | `src/routes/trips/` |
| Trip detail (Ideas / Plan / Route / People / Settings) | `src/routes/trips/[id]/` |
| Invite acceptance | `src/routes/join/[token]/` |
| Friends | `src/routes/friends/` |

### Data model highlights

- **Activities live in one table** (`activities`): an activity with no `scheduled_date`
  is an *idea* in the pool; setting a date promotes it onto the itinerary.
- **Interest votes** (`activity_votes`) sort the idea pool. They're deliberately kept
  separate from attendance/RSVP (a planned follow-up), so "this looks cool" and
  "I'm actually going" stay distinct signals.
- **Share-link invites** (`trip_invites`) let anyone join a trip — including people who
  aren't friends yet or don't have an account (they're routed through registration).
- **Route grouping** (`route_groups` + `route_group_items`): a group's `owner_id` is
  `NULL` for trip-wide shared groups or a user id for personal ones, so a stop can sit in
  one of your personal groups *and*, independently, one shared group. `kind` distinguishes
  auto-generated `day` groups from `custom` buckets. The route order is recomputed per
  group via the pure `buildRoute` function — no ordering is stored.

## Deploying

Built with `@sveltejs/adapter-node`, so `npm run build` produces a Node server in
`build/`. For production, point `DATABASE_DIR`/connection at a hosted Postgres and
switch the driver in `src/lib/server/db/index.ts` from `drizzle-orm/pglite` to
`drizzle-orm/postgres-js` (or Neon's serverless driver).
