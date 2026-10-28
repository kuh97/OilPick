CREATE EXTENSION IF NOT EXISTS postgis;
--> statement-breakpoint
CREATE TABLE "road_link" (
	"link_id" text PRIMARY KEY NOT NULL,
	"from_node" text NOT NULL,
	"to_node" text NOT NULL,
	"lanes" integer,
	"road_rank" text,
	"road_type" text,
	"road_no" text,
	"road_name" text,
	"road_use" text,
	"multi_link" text,
	"connect" text,
	"max_speed" integer,
	"rest_veh" text,
	"rest_w" integer,
	"rest_h" integer,
	"c_its" text,
	"length_m" double precision,
	"updated_date" date,
	"geometry" geometry(LineString, 5179) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "road_network_import" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_date" date NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"node_count" integer NOT NULL,
	"link_count" integer NOT NULL,
	"turn_count" integer NOT NULL,
	"source_file" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "road_node" (
	"node_id" text PRIMARY KEY NOT NULL,
	"node_type" text NOT NULL,
	"node_name" text,
	"turn_p" text,
	"updated_date" date,
	"geometry" geometry(Point, 5179) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "road_turn" (
	"node_id" text NOT NULL,
	"turn_id" integer NOT NULL,
	"start_link" text NOT NULL,
	"end_link" text NOT NULL,
	"turn_type" text,
	"turn_oper" text,
	"remark" text,
	CONSTRAINT "road_turn_node_id_turn_id_pk" PRIMARY KEY("node_id","turn_id")
);
--> statement-breakpoint
CREATE INDEX "idx_road_link_geometry" ON "road_link" USING gist ("geometry");--> statement-breakpoint
CREATE INDEX "idx_road_link_from_node" ON "road_link" USING btree ("from_node");--> statement-breakpoint
CREATE INDEX "idx_road_link_to_node" ON "road_link" USING btree ("to_node");--> statement-breakpoint
CREATE INDEX "idx_road_node_geometry" ON "road_node" USING gist ("geometry");--> statement-breakpoint
CREATE INDEX "idx_road_turn_start" ON "road_turn" USING btree ("start_link");--> statement-breakpoint
CREATE INDEX "idx_road_turn_end" ON "road_turn" USING btree ("end_link");
