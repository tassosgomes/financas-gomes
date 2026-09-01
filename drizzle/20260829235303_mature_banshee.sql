CREATE TYPE "public"."account_status" AS ENUM('ACTIVE', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."account_type" AS ENUM('CHECKING', 'SAVINGS', 'CASH', 'CREDIT_CARD', 'BENEFIT', 'INVESTMENT', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."category_kind" AS ENUM('EXPENSE', 'INCOME');--> statement-breakpoint
CREATE TYPE "public"."liquidity" AS ENUM('IMMEDIATE', 'LIQUID', 'RESTRICTED');--> statement-breakpoint
CREATE TYPE "public"."spendability" AS ENUM('GENERAL', 'RESTRICTED', 'EXCLUDED');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" "account_type" NOT NULL,
	"status" "account_status" DEFAULT 'ACTIVE' NOT NULL,
	"spendability" "spendability" DEFAULT 'GENERAL' NOT NULL,
	"liquidity" "liquidity" DEFAULT 'IMMEDIATE' NOT NULL,
	"include_in_net_worth" boolean DEFAULT true NOT NULL,
	"tracking_started_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_name_length_check" CHECK (char_length("accounts"."name") between 1 and 120),
	CONSTRAINT "accounts_name_no_control_check" CHECK ("accounts"."name" !~ '[[:cntrl:]]')
);
--> statement-breakpoint
CREATE TABLE "application_commands" (
	"household_id" uuid NOT NULL,
	"command_id" text NOT NULL,
	"operation" text NOT NULL,
	"payload_hash" text NOT NULL,
	"resource_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "application_commands_pkey" PRIMARY KEY("household_id","command_id"),
	CONSTRAINT "application_commands_command_id_check" CHECK (char_length(btrim("application_commands"."command_id")) between 1 and 128),
	CONSTRAINT "application_commands_operation_check" CHECK (char_length(btrim("application_commands"."operation")) between 1 and 128)
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	"parent_id" uuid,
	"kind" "category_kind" NOT NULL,
	"status" "account_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_id_household_id_uq" UNIQUE("id","household_id"),
	CONSTRAINT "categories_name_length_check" CHECK (char_length("categories"."name") between 1 and 120),
	CONSTRAINT "categories_name_no_control_check" CHECK ("categories"."name" !~ '[[:cntrl:]]'),
	CONSTRAINT "categories_parent_not_self_check" CHECK ("categories"."parent_id" is null or "categories"."parent_id" <> "categories"."id")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_commands" ADD CONSTRAINT "application_commands_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_same_household_fkey" FOREIGN KEY ("parent_id","household_id") REFERENCES "public"."categories"("id","household_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_id_household_id_uq" ON "accounts" USING btree ("id","household_id");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_household_name_ci_uq" ON "accounts" USING btree ("household_id",lower("name"));--> statement-breakpoint
CREATE INDEX "accounts_household_status_name_idx" ON "accounts" USING btree ("household_id","status","name");--> statement-breakpoint
CREATE INDEX "application_commands_household_created_at_idx" ON "application_commands" USING btree ("household_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_household_parent_name_ci_uq" ON "categories" USING btree ("household_id",coalesce("parent_id", '00000000-0000-0000-0000-000000000000'::uuid),lower("name"));--> statement-breakpoint
CREATE INDEX "categories_household_parent_status_name_idx" ON "categories" USING btree ("household_id","parent_id","status","name");