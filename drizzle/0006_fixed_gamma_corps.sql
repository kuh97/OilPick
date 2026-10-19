CREATE TABLE "admin_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"subject" text NOT NULL,
	"content" text NOT NULL,
	"station_id" text,
	"search_id" uuid,
	"status" text DEFAULT 'NEW' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "idx_admin_feedback_created" ON "admin_feedback" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_admin_feedback_status" ON "admin_feedback" USING btree ("status");