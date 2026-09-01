CREATE TYPE "public"."account_entry_status" AS ENUM('POSTED');--> statement-breakpoint
CREATE TYPE "public"."financial_event_kind" AS ENUM('EXPENSE', 'INCOME', 'REVERSAL');--> statement-breakpoint
CREATE TYPE "public"."financial_event_origin" AS ENUM('MANUAL', 'SYSTEM');--> statement-breakpoint
CREATE TYPE "public"."financial_event_status" AS ENUM('POSTED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "account_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"financial_event_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"household_id" uuid NOT NULL,
	"amount_cents" bigint NOT NULL,
	"status" "account_entry_status" DEFAULT 'POSTED' NOT NULL,
	"expected_on" date,
	"posted_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_entries_amount_nonzero_check" CHECK ("account_entries"."amount_cents" <> 0),
	CONSTRAINT "account_entries_posted_shape_check" CHECK ("account_entries"."status" = 'POSTED'
        and "account_entries"."posted_on" is not null
        and "account_entries"."expected_on" is null)
);
--> statement-breakpoint
CREATE TABLE "financial_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"kind" "financial_event_kind" NOT NULL,
	"status" "financial_event_status" DEFAULT 'POSTED' NOT NULL,
	"origin" "financial_event_origin" NOT NULL,
	"amount_cents" bigint NOT NULL,
	"occurred_on" date NOT NULL,
	"description" text NOT NULL,
	"category_id" uuid,
	"reversal_of_event_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "financial_events_amount_positive_check" CHECK ("financial_events"."amount_cents" > 0),
	CONSTRAINT "financial_events_description_length_check" CHECK (char_length("financial_events"."description") between 1 and 240),
	CONSTRAINT "financial_events_description_no_control_check" CHECK ("financial_events"."description" !~ '[[:cntrl:]]'),
	CONSTRAINT "financial_events_reversal_shape_check" CHECK ((
        ("financial_events"."kind" = 'REVERSAL'
          and "financial_events"."origin" = 'SYSTEM'
          and "financial_events"."status" = 'POSTED'
          and "financial_events"."reversal_of_event_id" is not null)
        or
        ("financial_events"."kind" <> 'REVERSAL'
          and "financial_events"."origin" = 'MANUAL'
          and "financial_events"."reversal_of_event_id" is null)
      ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "financial_events_id_household_id_uq" ON "financial_events" USING btree ("id","household_id");--> statement-breakpoint
ALTER TABLE "account_entries" ADD CONSTRAINT "account_entries_financial_event_household_fkey" FOREIGN KEY ("financial_event_id","household_id") REFERENCES "public"."financial_events"("id","household_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_entries" ADD CONSTRAINT "account_entries_account_household_fkey" FOREIGN KEY ("account_id","household_id") REFERENCES "public"."accounts"("id","household_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_events" ADD CONSTRAINT "financial_events_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_events" ADD CONSTRAINT "financial_events_category_household_fkey" FOREIGN KEY ("category_id","household_id") REFERENCES "public"."categories"("id","household_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_events" ADD CONSTRAINT "financial_events_reversal_of_event_household_fkey" FOREIGN KEY ("reversal_of_event_id","household_id") REFERENCES "public"."financial_events"("id","household_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_entries_household_account_posted_on_idx" ON "account_entries" USING btree ("household_id","account_id","posted_on");--> statement-breakpoint
CREATE INDEX "account_entries_household_event_idx" ON "account_entries" USING btree ("household_id","financial_event_id");--> statement-breakpoint
CREATE INDEX "financial_events_household_occurred_on_idx" ON "financial_events" USING btree ("household_id","occurred_on");--> statement-breakpoint
CREATE INDEX "financial_events_household_category_occurred_on_idx" ON "financial_events" USING btree ("household_id","category_id","occurred_on");--> statement-breakpoint
CREATE UNIQUE INDEX "financial_events_reversal_of_event_uq" ON "financial_events" USING btree ("reversal_of_event_id") WHERE "financial_events"."reversal_of_event_id" is not null;
