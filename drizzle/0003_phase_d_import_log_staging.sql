CREATE TABLE "csv_import_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"priced_on" date,
	"status" text NOT NULL,
	"failed_gate" text,
	"detail" text,
	"oil_rows" integer,
	"lpg_rows" integer,
	"geocoded" integer
);
--> statement-breakpoint
CREATE TABLE "refuel_point_staging" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"brand_code" text NOT NULL,
	"energy_type" text NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"coord_source" text,
	"address_road" text,
	"sigun_cd" text,
	"is_self" boolean,
	"priced_on" date,
	"last_seen_on" date,
	"price_gasoline" integer,
	"price_diesel" integer,
	"price_lpg" integer,
	"price_premium" integer,
	"price_kerosene" integer
);
