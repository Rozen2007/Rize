DO $$ BEGIN
 CREATE TYPE "action_type" AS ENUM('PAYMENT_RECOVERY_LINK', 'TARGETED_DYNAMIC_DISCOUNT', 'DO_NOTHING');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "failure_reason" AS ENUM('PRICE_FRICTION', 'BANK_DECLINE', 'AUTH_TIMEOUT', 'EXPIRED_CARD');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "incident_status" AS ENUM('PENDING', 'EXECUTING', 'EXECUTED_PENDING_SETTLEMENT', 'BLOCKED_INSUFFICIENT_MARGIN', 'RECOVERED', 'EXPIRED', 'SKIPPED_MISSING_CONTACT', 'CONTROL_HELDOUT');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_ledger" (
	"sequence_id" integer PRIMARY KEY NOT NULL,
	"incident_id" text NOT NULL,
	"event_type" text NOT NULL,
	"eni_score" double precision NOT NULL,
	"previous_hash" text NOT NULL,
	"current_hash" text NOT NULL,
	"created_at_ms" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cohort_stats" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"cohort_key" text NOT NULL,
	"action_type" "action_type" NOT NULL,
	"total_attempts" integer DEFAULT 0 NOT NULL,
	"total_successes" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cohort_stats_merchant_id_cohort_key_action_type_unique" UNIQUE("merchant_id","cohort_key","action_type")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "incidents" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"razorpay_event_id" text NOT NULL,
	"batch_id" text,
	"checkout_id" text NOT NULL,
	"customer_phone" text,
	"order_value" double precision NOT NULL,
	"failure_reason" "failure_reason" NOT NULL,
	"device" text NOT NULL,
	"payment_method" text NOT NULL,
	"affected_cohort" text NOT NULL,
	"is_control" boolean DEFAULT false NOT NULL,
	"winning_action" "action_type" NOT NULL,
	"winning_eni" double precision NOT NULL,
	"winning_prec" double precision NOT NULL,
	"discount_offered" double precision DEFAULT 0 NOT NULL,
	"candidates_json" text NOT NULL,
	"rejection_reason" text,
	"razorpay_link_id" text,
	"razorpay_link_url" text,
	"razorpay_payment_id" text,
	"status" "incident_status" DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "incidents_razorpay_event_id_unique" UNIQUE("razorpay_event_id"),
	CONSTRAINT "incidents_razorpay_link_id_unique" UNIQUE("razorpay_link_id"),
	CONSTRAINT "incidents_razorpay_payment_id_unique" UNIQUE("razorpay_payment_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "merchants" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"webhook_secret" text NOT NULL,
	"gross_margin_ratio" double precision DEFAULT 0.4 NOT NULL,
	"mdr_rate" double precision DEFAULT 0.02 NOT NULL,
	"max_discount_cap" double precision DEFAULT 0.15 NOT NULL,
	"min_margin_floor" double precision DEFAULT 0.1 NOT NULL,
	"control_group_ratio" double precision DEFAULT 0.1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "processed_webhook_events" (
	"event_id" text PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"processed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_ledger" ADD CONSTRAINT "audit_ledger_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cohort_stats" ADD CONSTRAINT "cohort_stats_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "incidents" ADD CONSTRAINT "incidents_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
