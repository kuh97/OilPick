CREATE TABLE "navi_click_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"search_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"app" text NOT NULL,
	"rank" smallint NOT NULL,
	"tier" text NOT NULL,
	"net_saving" integer,
	"detour_distance_m" integer
);
--> statement-breakpoint
CREATE TABLE "search_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"fuel" text NOT NULL,
	"filters" jsonb NOT NULL,
	"origin_cell" text NOT NULL,
	"dest_cell" text NOT NULL,
	"base_distance_m" integer NOT NULL,
	"base_duration_s" integer NOT NULL,
	"t1_count" smallint NOT NULL,
	"t2_count" smallint NOT NULL,
	"t3_count" smallint NOT NULL,
	"expansion_triggered" boolean NOT NULL,
	"final_radius_m" integer NOT NULL,
	"reference_price" integer,
	"ref_price_source" text,
	"route_calls" smallint NOT NULL,
	"duration_ms" integer NOT NULL,
	"warnings" text[]
);
--> statement-breakpoint
ALTER TABLE "navi_click_event" ADD CONSTRAINT "navi_click_event_search_id_search_event_id_fk" FOREIGN KEY ("search_id") REFERENCES "public"."search_event"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_search_event_created" ON "search_event" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_search_event_expand" ON "search_event" USING btree ("expansion_triggered","created_at");