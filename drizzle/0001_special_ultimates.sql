CREATE TABLE "route_group_items" (
	"group_id" uuid NOT NULL,
	"activity_id" uuid NOT NULL,
	CONSTRAINT "route_group_items_group_id_activity_id_pk" PRIMARY KEY("group_id","activity_id")
);
--> statement-breakpoint
CREATE TABLE "route_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"owner_id" uuid,
	"name" text NOT NULL,
	"kind" text DEFAULT 'custom' NOT NULL,
	"day_date" date,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "route_group_items" ADD CONSTRAINT "route_group_items_group_id_route_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."route_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_group_items" ADD CONSTRAINT "route_group_items_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_groups" ADD CONSTRAINT "route_groups_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_groups" ADD CONSTRAINT "route_groups_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "route_groups_trip_idx" ON "route_groups" USING btree ("trip_id");