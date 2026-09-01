CREATE TYPE "public"."planned_event_status" AS ENUM('PLANNED', 'EXPECTED', 'POSTED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."recurring_day_rule" AS ENUM('FIXED_DAY', 'FIRST_BUSINESS_DAY', 'LAST_BUSINESS_DAY');--> statement-breakpoint
CREATE TYPE "public"."recurring_frequency" AS ENUM('MONTHLY', 'YEARLY');--> statement-breakpoint
CREATE TYPE "public"."recurring_occurrence_status" AS ENUM('PLANNED', 'EXPECTED', 'POSTED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "holidays" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"date" date NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "holidays_name_length_check" CHECK (char_length("holidays"."name") between 1 and 240),
	CONSTRAINT "holidays_name_no_control_check" CHECK ("holidays"."name" !~ '[[:cntrl:]]')
);
--> statement-breakpoint
CREATE TABLE "planned_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"account_id" uuid,
	"category_id" uuid,
	"kind" "financial_event_kind" NOT NULL,
	"status" "planned_event_status" DEFAULT 'PLANNED' NOT NULL,
	"amount_cents" bigint NOT NULL,
	"expected_on" date NOT NULL,
	"description" text NOT NULL,
	"include_in_conservative_forecast" boolean DEFAULT true NOT NULL,
	"financial_event_id" uuid,
	"is_partial" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "planned_events_kind_check" CHECK ("planned_events"."kind" in ('EXPENSE', 'INCOME')),
	CONSTRAINT "planned_events_amount_positive_check" CHECK ("planned_events"."amount_cents" > 0),
	CONSTRAINT "planned_events_description_length_check" CHECK (char_length("planned_events"."description") between 1 and 240),
	CONSTRAINT "planned_events_description_no_control_check" CHECK ("planned_events"."description" !~ '[[:cntrl:]]'),
	CONSTRAINT "planned_events_status_shape_check" CHECK ((
        "planned_events"."status"::text = 'POSTED'
        and "planned_events"."financial_event_id" is not null
      )
      or (
        "planned_events"."status"::text <> 'POSTED'
        and "planned_events"."financial_event_id" is null
        and "planned_events"."is_partial" = false
      ))
);
--> statement-breakpoint
CREATE TABLE "recurring_occurrences" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"recurring_rule_id" uuid NOT NULL,
	"occurrence_key" text NOT NULL,
	"status" "recurring_occurrence_status" DEFAULT 'PLANNED' NOT NULL,
	"amount_cents" bigint,
	"expected_on" date,
	"financial_event_id" uuid,
	"is_partial" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_occurrences_key_format_check" CHECK ("recurring_occurrences"."occurrence_key" ~ '^[0-9]{4}(-((0[1-9])|(1[0-2])))?$'),
	CONSTRAINT "recurring_occurrences_amount_positive_check" CHECK ("recurring_occurrences"."amount_cents" is null or "recurring_occurrences"."amount_cents" > 0),
	CONSTRAINT "recurring_occurrences_status_shape_check" CHECK ((
        "recurring_occurrences"."status"::text = 'POSTED'
        and "recurring_occurrences"."financial_event_id" is not null
      )
      or (
        "recurring_occurrences"."status"::text <> 'POSTED'
        and "recurring_occurrences"."financial_event_id" is null
        and "recurring_occurrences"."is_partial" = false
      ))
);
--> statement-breakpoint
CREATE TABLE "recurring_rules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"account_id" uuid,
	"category_id" uuid,
	"kind" "financial_event_kind" NOT NULL,
	"amount_cents" bigint NOT NULL,
	"description" text NOT NULL,
	"frequency" "recurring_frequency" NOT NULL,
	"day_rule" "recurring_day_rule" NOT NULL,
	"day_of_month" integer,
	"start_on" date NOT NULL,
	"end_on" date,
	"include_in_conservative_forecast" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_rules_kind_check" CHECK ("recurring_rules"."kind" in ('EXPENSE', 'INCOME')),
	CONSTRAINT "recurring_rules_amount_positive_check" CHECK ("recurring_rules"."amount_cents" > 0),
	CONSTRAINT "recurring_rules_description_length_check" CHECK (char_length("recurring_rules"."description") between 1 and 240),
	CONSTRAINT "recurring_rules_description_no_control_check" CHECK ("recurring_rules"."description" !~ '[[:cntrl:]]'),
	CONSTRAINT "recurring_rules_effective_interval_check" CHECK ("recurring_rules"."end_on" is null or "recurring_rules"."end_on" >= "recurring_rules"."start_on"),
	CONSTRAINT "recurring_rules_day_rule_shape_check" CHECK ((
        ("recurring_rules"."day_rule" = 'FIXED_DAY'
          and "recurring_rules"."day_of_month" between 1 and 31)
        or
        ("recurring_rules"."day_rule" <> 'FIXED_DAY'
          and "recurring_rules"."day_of_month" is null)
      ))
);
--> statement-breakpoint
-- Composite referenced keys must exist before PostgreSQL adds the tenant-safe
-- foreign keys from recurring occurrences to their rule.
CREATE UNIQUE INDEX "recurring_rules_id_household_id_uq"
  ON "recurring_rules" USING btree ("id", "household_id");--> statement-breakpoint
ALTER TABLE "application_commands" DROP CONSTRAINT "application_commands_operation_allowlist_check";--> statement-breakpoint
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_events" ADD CONSTRAINT "planned_events_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_events" ADD CONSTRAINT "planned_events_account_household_fkey" FOREIGN KEY ("account_id","household_id") REFERENCES "public"."accounts"("id","household_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_events" ADD CONSTRAINT "planned_events_category_household_fkey" FOREIGN KEY ("category_id","household_id") REFERENCES "public"."categories"("id","household_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_events" ADD CONSTRAINT "planned_events_event_household_fkey" FOREIGN KEY ("financial_event_id","household_id") REFERENCES "public"."financial_events"("id","household_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_occurrences" ADD CONSTRAINT "recurring_occurrences_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_occurrences" ADD CONSTRAINT "recurring_occurrences_rule_household_fkey" FOREIGN KEY ("recurring_rule_id","household_id") REFERENCES "public"."recurring_rules"("id","household_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_occurrences" ADD CONSTRAINT "recurring_occurrences_event_household_fkey" FOREIGN KEY ("financial_event_id","household_id") REFERENCES "public"."financial_events"("id","household_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_account_household_fkey" FOREIGN KEY ("account_id","household_id") REFERENCES "public"."accounts"("id","household_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_category_household_fkey" FOREIGN KEY ("category_id","household_id") REFERENCES "public"."categories"("id","household_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "holidays_id_household_id_uq" ON "holidays" USING btree ("id","household_id");--> statement-breakpoint
CREATE UNIQUE INDEX "holidays_household_date_uq" ON "holidays" USING btree ("household_id","date");--> statement-breakpoint
CREATE INDEX "holidays_household_date_idx" ON "holidays" USING btree ("household_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "planned_events_id_household_id_uq" ON "planned_events" USING btree ("id","household_id");--> statement-breakpoint
CREATE UNIQUE INDEX "planned_events_financial_event_id_uq" ON "planned_events" USING btree ("financial_event_id") WHERE "planned_events"."financial_event_id" is not null;--> statement-breakpoint
CREATE INDEX "planned_events_household_expected_on_idx" ON "planned_events" USING btree ("household_id","expected_on");--> statement-breakpoint
CREATE INDEX "planned_events_household_status_expected_on_idx" ON "planned_events" USING btree ("household_id","status","expected_on");--> statement-breakpoint
CREATE INDEX "planned_events_household_kind_expected_on_idx" ON "planned_events" USING btree ("household_id","kind","expected_on");--> statement-breakpoint
CREATE UNIQUE INDEX "recurring_occurrences_id_household_id_uq" ON "recurring_occurrences" USING btree ("id","household_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recurring_occurrences_rule_key_uq" ON "recurring_occurrences" USING btree ("recurring_rule_id","occurrence_key");--> statement-breakpoint
CREATE UNIQUE INDEX "recurring_occurrences_financial_event_id_uq" ON "recurring_occurrences" USING btree ("financial_event_id") WHERE "recurring_occurrences"."financial_event_id" is not null;--> statement-breakpoint
CREATE INDEX "recurring_occurrences_household_expected_on_idx" ON "recurring_occurrences" USING btree ("household_id","expected_on");--> statement-breakpoint
CREATE INDEX "recurring_occurrences_household_status_expected_on_idx" ON "recurring_occurrences" USING btree ("household_id","status","expected_on");--> statement-breakpoint
CREATE INDEX "recurring_occurrences_household_rule_key_idx" ON "recurring_occurrences" USING btree ("household_id","recurring_rule_id","occurrence_key");--> statement-breakpoint
CREATE INDEX "recurring_rules_household_active_window_idx" ON "recurring_rules" USING btree ("household_id","start_on","end_on");--> statement-breakpoint
CREATE INDEX "recurring_rules_household_frequency_start_idx" ON "recurring_rules" USING btree ("household_id","frequency","start_on");--> statement-breakpoint
CREATE INDEX "recurring_rules_household_kind_idx" ON "recurring_rules" USING btree ("household_id","kind");--> statement-breakpoint
ALTER TABLE "application_commands" ADD CONSTRAINT "application_commands_operation_allowlist_check" CHECK ("application_commands"."operation" in (
        'accounts.create',
        'accounts.update',
        'accounts.archive',
        'categories.create',
        'categories.update',
        'categories.archive',
        'transactions.create.expense',
        'transactions.create.income',
        'transactions.update.manual',
        'transactions.cancel.manual',
        'transactions.import.preview',
        'transactions.import.confirm',
        'transactions.review.update',
        'credit_card.create',
        'credit_card.update',
        'credit_card.archive',
        'credit_card.billing_rule.create',
        'credit_card.billing_rule.update',
        'credit_card.purchase.create',
        'credit_card.purchase.update_metadata',
        'credit_card.purchase.cancel',
        'credit_card.payment.create',
        'recurring_rule.create',
        'recurring_rule.update_future',
        'recurring_rule.end',
        'recurring_occurrence.override',
        'recurring_occurrence.cancel',
        'recurring_occurrence.realize',
        'planned_event.create',
        'planned_event.update',
        'planned_event.cancel'
      ));
--> statement-breakpoint
-- A persisted occurrence must use the key shape of its rule and can be
-- realized only by a POSTED fact with the same tenant and economic kind.
CREATE FUNCTION "public"."recurring_occurrence_integrity_check_fn"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  rule_frequency "public"."recurring_frequency";
  rule_kind "public"."financial_event_kind";
  event_status "public"."financial_event_status";
  event_kind "public"."financial_event_kind";
BEGIN
  SELECT rr."frequency", rr."kind"
    INTO rule_frequency, rule_kind
    FROM "public"."recurring_rules" rr
   WHERE rr."id" = NEW."recurring_rule_id"
     AND rr."household_id" = NEW."household_id";

  IF rule_frequency IS NULL THEN
    RAISE EXCEPTION 'recurring_occurrences.recurring_rule_id has no matching household rule'
      USING ERRCODE = '23503';
  END IF;

  IF (rule_frequency = 'MONTHLY' AND NEW."occurrence_key" !~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
     OR (rule_frequency = 'YEARLY' AND NEW."occurrence_key" !~ '^[0-9]{4}$') THEN
    RAISE EXCEPTION 'recurring_occurrences.occurrence_key does not match rule frequency'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."financial_event_id" IS NOT NULL THEN
    SELECT fe."status", fe."kind"
      INTO event_status, event_kind
      FROM "public"."financial_events" fe
     WHERE fe."id" = NEW."financial_event_id"
       AND fe."household_id" = NEW."household_id";

    IF event_status IS NULL
       OR event_status <> 'POSTED'
       OR event_kind <> rule_kind THEN
      RAISE EXCEPTION 'recurring_occurrences.financial_event_id must reference a matching POSTED event'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "recurring_occurrence_integrity_check"
BEFORE INSERT OR UPDATE OF "recurring_rule_id", "household_id", "occurrence_key", "status", "financial_event_id"
ON "public"."recurring_occurrences"
FOR EACH ROW
EXECUTE FUNCTION "public"."recurring_occurrence_integrity_check_fn"();
--> statement-breakpoint
-- Planned events use the same explicit-reconciliation rule and must not link
-- an income source to an expense fact (or a non-posted fact).
CREATE FUNCTION "public"."planned_event_integrity_check_fn"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  event_status "public"."financial_event_status";
  event_kind "public"."financial_event_kind";
BEGIN
  IF NEW."financial_event_id" IS NOT NULL THEN
    SELECT fe."status", fe."kind"
      INTO event_status, event_kind
      FROM "public"."financial_events" fe
     WHERE fe."id" = NEW."financial_event_id"
       AND fe."household_id" = NEW."household_id";

    IF event_status IS NULL
       OR event_status <> 'POSTED'
       OR event_kind <> NEW."kind" THEN
      RAISE EXCEPTION 'planned_events.financial_event_id must reference a matching POSTED event'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "planned_event_integrity_check"
BEFORE INSERT OR UPDATE OF "household_id", "kind", "status", "financial_event_id"
ON "public"."planned_events"
FOR EACH ROW
EXECUTE FUNCTION "public"."planned_event_integrity_check_fn"();
--> statement-breakpoint
-- A single fact cannot reconcile two different S07 source rows.  The two
-- partial unique indexes above protect each source table independently; this
-- trigger closes the cross-table gap without introducing a duplicate ledger.
CREATE FUNCTION "public"."planned_source_event_exclusivity_check_fn"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."financial_event_id" IS NOT NULL
     AND EXISTS (
       SELECT 1
         FROM "public"."recurring_occurrences" occurrence
        WHERE occurrence."financial_event_id" = NEW."financial_event_id"
          AND occurrence."household_id" = NEW."household_id"
     ) THEN
    RAISE EXCEPTION 'a financial event may reconcile only one S07 source'
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "planned_source_event_exclusivity_check"
BEFORE INSERT OR UPDATE OF "household_id", "financial_event_id"
ON "public"."planned_events"
FOR EACH ROW
EXECUTE FUNCTION "public"."planned_source_event_exclusivity_check_fn"();
--> statement-breakpoint
CREATE FUNCTION "public"."recurring_source_event_exclusivity_check_fn"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."financial_event_id" IS NOT NULL
     AND EXISTS (
       SELECT 1
         FROM "public"."planned_events" planned
        WHERE planned."financial_event_id" = NEW."financial_event_id"
          AND planned."household_id" = NEW."household_id"
     ) THEN
    RAISE EXCEPTION 'a financial event may reconcile only one S07 source'
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "recurring_source_event_exclusivity_check"
BEFORE INSERT OR UPDATE OF "household_id", "financial_event_id"
ON "public"."recurring_occurrences"
FOR EACH ROW
EXECUTE FUNCTION "public"."recurring_source_event_exclusivity_check_fn"();
