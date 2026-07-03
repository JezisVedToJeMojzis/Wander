DROP TABLE "route_group_items" CASCADE;--> statement-breakpoint
DROP TABLE "route_groups" CASCADE;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "day_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "activities" SET "category" = 'clubbing' WHERE "category" = 'nightlife';