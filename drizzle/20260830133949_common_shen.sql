CREATE TYPE "public"."transaction_import_source_columns" AS ENUM('BASE', 'WITH_EXTERNAL_ID');--> statement-breakpoint
CREATE TYPE "public"."transaction_import_status" AS ENUM('CONFIRMED');--> statement-breakpoint
ALTER TYPE "public"."financial_event_origin" ADD VALUE 'IMPORT';--> statement-breakpoint
CREATE TABLE "transaction_import_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"import_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"external_id" text,
	"financial_event_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transaction_import_items_row_number_check" CHECK ("transaction_import_items"."row_number" >= 2),
	CONSTRAINT "transaction_import_items_external_id_check" CHECK ("transaction_import_items"."external_id" is null
        or (char_length("transaction_import_items"."external_id") between 1 and 128
          and "transaction_import_items"."external_id" !~ '[[:cntrl:]]'))
);
--> statement-breakpoint
CREATE TABLE "transaction_import_staging" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"dataset_fingerprint" text NOT NULL,
	"format_version" text NOT NULL,
	"source_file_size_bytes" integer NOT NULL,
	"source_has_bom" boolean NOT NULL,
	"source_columns" "transaction_import_source_columns" NOT NULL,
	"processed_rows" integer NOT NULL,
	"valid_rows" integer NOT NULL,
	"invalid_rows" integer NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"candidate_rows" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transaction_import_staging_token_hash_check" CHECK ("transaction_import_staging"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "transaction_import_staging_format_version_check" CHECK ("transaction_import_staging"."format_version" = 's04-csv-v1'),
	CONSTRAINT "transaction_import_staging_fingerprint_check" CHECK ("transaction_import_staging"."dataset_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "transaction_import_staging_source_file_size_check" CHECK ("transaction_import_staging"."source_file_size_bytes" between 0 and 5242880),
	CONSTRAINT "transaction_import_staging_processed_rows_check" CHECK ("transaction_import_staging"."processed_rows" between 1 and 10000),
	CONSTRAINT "transaction_import_staging_valid_rows_check" CHECK ("transaction_import_staging"."valid_rows" between 1 and 10000),
	CONSTRAINT "transaction_import_staging_count_partition_check" CHECK ("transaction_import_staging"."processed_rows" = "transaction_import_staging"."valid_rows" + "transaction_import_staging"."invalid_rows"),
	CONSTRAINT "transaction_import_staging_invalid_rows_check" CHECK ("transaction_import_staging"."invalid_rows" between 0 and 10000),
	CONSTRAINT "transaction_import_staging_errors_array_check" CHECK (jsonb_typeof("transaction_import_staging"."errors") = 'array'),
	CONSTRAINT "transaction_import_staging_candidates_array_check" CHECK (jsonb_typeof("transaction_import_staging"."candidate_rows") = 'array'
        and jsonb_array_length("transaction_import_staging"."candidate_rows") = "transaction_import_staging"."valid_rows"),
	CONSTRAINT "transaction_import_staging_expiry_check" CHECK ("transaction_import_staging"."expires_at" > "transaction_import_staging"."created_at"),
	CONSTRAINT "transaction_import_staging_consumed_at_check" CHECK ("transaction_import_staging"."consumed_at" is null or "transaction_import_staging"."consumed_at" >= "transaction_import_staging"."created_at")
);
--> statement-breakpoint
CREATE TABLE "transaction_imports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"initiated_by_user_id" uuid,
	"format_version" text NOT NULL,
	"dataset_fingerprint" text NOT NULL,
	"source_file_size_bytes" integer NOT NULL,
	"source_has_bom" boolean NOT NULL,
	"source_columns" "transaction_import_source_columns" NOT NULL,
	"processed_rows" integer NOT NULL,
	"valid_rows" integer NOT NULL,
	"invalid_rows" integer NOT NULL,
	"ignored_duplicate_rows" integer NOT NULL,
	"imported_rows" integer NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "transaction_import_status" DEFAULT 'CONFIRMED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transaction_imports_format_version_check" CHECK ("transaction_imports"."format_version" = 's04-csv-v1'),
	CONSTRAINT "transaction_imports_fingerprint_check" CHECK ("transaction_imports"."dataset_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "transaction_imports_source_file_size_check" CHECK ("transaction_imports"."source_file_size_bytes" between 0 and 5242880),
	CONSTRAINT "transaction_imports_processed_rows_check" CHECK ("transaction_imports"."processed_rows" between 0 and 10000),
	CONSTRAINT "transaction_imports_valid_rows_check" CHECK ("transaction_imports"."valid_rows" between 0 and 10000),
	CONSTRAINT "transaction_imports_invalid_rows_check" CHECK ("transaction_imports"."invalid_rows" between 0 and 10000),
	CONSTRAINT "transaction_imports_ignored_duplicate_rows_check" CHECK ("transaction_imports"."ignored_duplicate_rows" between 0 and 10000),
	CONSTRAINT "transaction_imports_imported_rows_check" CHECK ("transaction_imports"."imported_rows" between 0 and 10000),
	CONSTRAINT "transaction_imports_count_partition_check" CHECK ("transaction_imports"."processed_rows" = "transaction_imports"."valid_rows" + "transaction_imports"."invalid_rows"),
	CONSTRAINT "transaction_imports_count_result_check" CHECK ("transaction_imports"."imported_rows" + "transaction_imports"."ignored_duplicate_rows" <= "transaction_imports"."valid_rows"),
	CONSTRAINT "transaction_imports_confirmed_count_check" CHECK ("transaction_imports"."status" = 'CONFIRMED'
        and "transaction_imports"."ignored_duplicate_rows" = 0
        and "transaction_imports"."imported_rows" = "transaction_imports"."valid_rows"
        and "transaction_imports"."confirmed_at" >= "transaction_imports"."created_at"),
	CONSTRAINT "transaction_imports_errors_array_check" CHECK (jsonb_typeof("transaction_imports"."errors") = 'array')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "transaction_imports_id_household_id_uq" ON "transaction_imports" USING btree ("id","household_id");--> statement-breakpoint
ALTER TABLE "financial_events" DROP CONSTRAINT "financial_events_reversal_shape_check";--> statement-breakpoint
ALTER TABLE "transaction_import_items" ADD CONSTRAINT "transaction_import_items_import_household_fkey" FOREIGN KEY ("import_id","household_id") REFERENCES "public"."transaction_imports"("id","household_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_import_items" ADD CONSTRAINT "transaction_import_items_event_household_fkey" FOREIGN KEY ("financial_event_id","household_id") REFERENCES "public"."financial_events"("id","household_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_import_staging" ADD CONSTRAINT "transaction_import_staging_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_import_staging" ADD CONSTRAINT "transaction_import_staging_account_household_fkey" FOREIGN KEY ("account_id","household_id") REFERENCES "public"."accounts"("id","household_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_imports" ADD CONSTRAINT "transaction_imports_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_imports" ADD CONSTRAINT "transaction_imports_account_household_fkey" FOREIGN KEY ("account_id","household_id") REFERENCES "public"."accounts"("id","household_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_imports" ADD CONSTRAINT "transaction_imports_initiated_by_user_id_fkey" FOREIGN KEY ("initiated_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_imports" ADD CONSTRAINT "transaction_imports_initiator_member_fkey" FOREIGN KEY ("household_id","initiated_by_user_id") REFERENCES "public"."household_members"("household_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "transaction_import_items_import_row_uq" ON "transaction_import_items" USING btree ("import_id","row_number");--> statement-breakpoint
CREATE INDEX "transaction_import_items_household_import_row_idx" ON "transaction_import_items" USING btree ("household_id","import_id","row_number");--> statement-breakpoint
CREATE INDEX "transaction_import_items_household_event_idx" ON "transaction_import_items" USING btree ("household_id","financial_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transaction_import_staging_household_token_hash_uq" ON "transaction_import_staging" USING btree ("household_id","token_hash");--> statement-breakpoint
CREATE INDEX "transaction_import_staging_household_expires_at_idx" ON "transaction_import_staging" USING btree ("household_id","expires_at");--> statement-breakpoint
CREATE INDEX "transaction_import_staging_household_fingerprint_idx" ON "transaction_import_staging" USING btree ("household_id","account_id","dataset_fingerprint");--> statement-breakpoint
CREATE INDEX "transaction_imports_household_account_created_at_idx" ON "transaction_imports" USING btree ("household_id","account_id","created_at");--> statement-breakpoint
CREATE INDEX "transaction_imports_household_status_created_at_idx" ON "transaction_imports" USING btree ("household_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "transaction_imports_household_account_fingerprint_uq" ON "transaction_imports" USING btree ("household_id","account_id","dataset_fingerprint") WHERE "transaction_imports"."status" = 'CONFIRMED';--> statement-breakpoint
ALTER TABLE "financial_events" ADD CONSTRAINT "financial_events_reversal_shape_check" CHECK ((
        ("financial_events"."kind" = 'REVERSAL'
          and "financial_events"."origin" = 'SYSTEM'
          and "financial_events"."status" = 'POSTED'
          and "financial_events"."reversal_of_event_id" is not null)
        or
        ("financial_events"."kind" <> 'REVERSAL'
          and "financial_events"."origin"::text in ('MANUAL', 'IMPORT')
          and ("financial_events"."origin"::text = 'MANUAL' or "financial_events"."status" = 'POSTED')
          and "financial_events"."reversal_of_event_id" is null)
      ));
