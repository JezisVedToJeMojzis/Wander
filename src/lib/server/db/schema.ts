import {
	pgTable,
	uuid,
	text,
	timestamp,
	integer,
	date,
	primaryKey,
	uniqueIndex,
	index,
	smallint
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const users = pgTable('users', {
	id: uuid('id').primaryKey().defaultRandom(),
	// Name is the login identifier, so it must be unique.
	name: text('name').notNull().unique(),
	passwordHash: text('password_hash').notNull(),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export const sessions = pgTable('sessions', {
	id: text('id').primaryKey(), // random token stored in the cookie
	userId: uuid('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	expiresAt: timestamp('expires_at', { withTimezone: true }).notNull()
});

// Friendship is a single row per pair. `status` covers the request lifecycle.
// `requesterId` is who sent the request; the other side is the addressee.
export const friendships = pgTable(
	'friendships',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		requesterId: uuid('requester_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		addresseeId: uuid('addressee_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		status: text('status', { enum: ['pending', 'accepted'] })
			.notNull()
			.default('pending'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [uniqueIndex('friendships_pair_idx').on(t.requesterId, t.addresseeId)]
);

// ---------------------------------------------------------------------------
// Trips
// ---------------------------------------------------------------------------

export const trips = pgTable('trips', {
	id: uuid('id').primaryKey().defaultRandom(),
	name: text('name').notNull(),
	startDate: date('start_date'),
	endDate: date('end_date'),
	status: text('status', { enum: ['planning', 'scheduled', 'done'] })
		.notNull()
		.default('planning'),
	createdBy: uuid('created_by')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export const tripMembers = pgTable(
	'trip_members',
	{
		tripId: uuid('trip_id')
			.notNull()
			.references(() => trips.id, { onDelete: 'cascade' }),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		role: text('role', { enum: ['organizer', 'member'] })
			.notNull()
			.default('member'),
		joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [primaryKey({ columns: [t.tripId, t.userId] })]
);

// Share-link invites — lets people (incl. non-friends / not-yet-registered) join.
export const tripInvites = pgTable('trip_invites', {
	token: text('token').primaryKey(),
	tripId: uuid('trip_id')
		.notNull()
		.references(() => trips.id, { onDelete: 'cascade' }),
	createdBy: uuid('created_by')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

// ---------------------------------------------------------------------------
// Activities (idea pool + itinerary in one table)
// ---------------------------------------------------------------------------

export const activities = pgTable(
	'activities',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		tripId: uuid('trip_id')
			.notNull()
			.references(() => trips.id, { onDelete: 'cascade' }),
		title: text('title').notNull(),
		category: text('category', {
			enum: [
				'food',
				'cafe',
				'sightseeing',
				'museum',
				'culture',
				'streetart',
				'shopping',
				'thrifting',
				'market',
				'nature',
				'outdoors',
				'beach',
				'sport',
				'clubbing',
				'bar',
				'other'
			]
		})
			.notNull()
			.default('other'),
		notes: text('notes'),
		// Location: a free-text place plus optional precise coords for the maps link.
		locationName: text('location_name'),
		lat: text('lat'),
		lng: text('lng'),
		estCost: integer('est_cost'),
		// Scheduling: null = still just an idea; set = placed on the itinerary (a day).
		scheduledDate: date('scheduled_date'),
		// Manual order within a day, set by drag-and-drop in the Plan tab.
		dayOrder: integer('day_order').notNull().default(0),
		// Legacy time-of-day fields — scheduling is date-only now; kept nullable/unused.
		startTime: text('start_time'),
		durationMin: integer('duration_min'),
		proposedBy: uuid('proposed_by')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [index('activities_trip_idx').on(t.tripId)]
);

// Interest votes used to sort the idea pool. Separate from attendance.
export const activityVotes = pgTable(
	'activity_votes',
	{
		activityId: uuid('activity_id')
			.notNull()
			.references(() => activities.id, { onDelete: 'cascade' }),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		// 1 = interested, -1 = not interested
		value: smallint('value').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [primaryKey({ columns: [t.activityId, t.userId] })]
);

export type User = typeof users.$inferSelect;
export type Trip = typeof trips.$inferSelect;
export type Activity = typeof activities.$inferSelect;
