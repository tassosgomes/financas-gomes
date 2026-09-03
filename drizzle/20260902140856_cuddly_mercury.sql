CREATE TYPE "public"."budget_movement_kind" AS ENUM('CONTRIBUTION', 'WITHDRAWAL');--> statement-breakpoint
CREATE TYPE "public"."budget_movement_source_kind" AS ENUM('MANUAL', 'ALLOCATION', 'EXPENSE', 'REFUND', 'CORRECTION', 'TRANSFER');--> statement-breakpoint
CREATE TYPE "public"."budget_status" AS ENUM('ACTIVE', 'CLOSED');--> statement-breakpoint
CREATE TABLE "budget_allocation_rules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"budget_id" uuid NOT NULL,
	"amount_cents" bigint NOT NULL,
	"effective_from" date NOT NULL,
	"effective_until" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_allocation_rules_amount_nonnegative_check" CHECK ("budget_allocation_rules"."amount_cents" >= 0),
	CONSTRAINT "budget_allocation_rules_effective_interval_check" CHECK ("budget_allocation_rules"."effective_until" is null or "budget_allocation_rules"."effective_until" > "budget_allocation_rules"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "budget_movements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"budget_id" uuid NOT NULL,
	"reference_id" text NOT NULL,
	"kind" "budget_movement_kind" NOT NULL,
	"amount_cents" bigint NOT NULL,
	"effective_on" date NOT NULL,
	"source_kind" "budget_movement_source_kind" DEFAULT 'MANUAL' NOT NULL,
	"source_reference_id" text,
	"financial_event_id" uuid,
	"account_entry_id" uuid,
	"corrects_movement_id" uuid,
	"transfer_reference_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_movements_reference_id_shape_check" CHECK (char_length("budget_movements"."reference_id") between 1 and 256),
	CONSTRAINT "budget_movements_reference_id_no_control_check" CHECK ("budget_movements"."reference_id" !~ '[[:cntrl:]]'),
	CONSTRAINT "budget_movements_amount_positive_check" CHECK ("budget_movements"."amount_cents" > 0),
	CONSTRAINT "budget_movements_source_reference_shape_check" CHECK ("budget_movements"."source_reference_id" is null or (
        char_length("budget_movements"."source_reference_id") between 1 and 256
        and "budget_movements"."source_reference_id" !~ '[[:cntrl:]]'
      )),
	CONSTRAINT "budget_movements_transfer_reference_shape_check" CHECK ("budget_movements"."transfer_reference_id" is null or (
        char_length("budget_movements"."transfer_reference_id") between 1 and 256
        and "budget_movements"."transfer_reference_id" !~ '[[:cntrl:]]'
      ))
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"reference_id" text NOT NULL,
	"category_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" "budget_status" DEFAULT 'ACTIVE' NOT NULL,
	"active_from" date NOT NULL,
	"closed_on" date,
	"target_amount_cents" bigint,
	"target_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budgets_reference_id_shape_check" CHECK (char_length("budgets"."reference_id") between 1 and 256),
	CONSTRAINT "budgets_reference_id_no_control_check" CHECK ("budgets"."reference_id" !~ '[[:cntrl:]]'),
	CONSTRAINT "budgets_name_length_check" CHECK (char_length("budgets"."name") between 1 and 120),
	CONSTRAINT "budgets_name_no_control_check" CHECK ("budgets"."name" !~ '[[:cntrl:]]'),
	CONSTRAINT "budgets_status_shape_check" CHECK ((
        ("budgets"."status"::text = 'ACTIVE' and "budgets"."closed_on" is null)
        or
        ("budgets"."status"::text = 'CLOSED' and "budgets"."closed_on" is not null)
      )),
	CONSTRAINT "budgets_closed_on_range_check" CHECK ("budgets"."closed_on" is null or "budgets"."closed_on" >= "budgets"."active_from"),
	CONSTRAINT "budgets_target_shape_check" CHECK ((
        ("budgets"."target_amount_cents" is null and "budgets"."target_date" is null)
        or
        (
          "budgets"."target_amount_cents" > 0
          and "budgets"."target_date" is not null
          and "budgets"."target_date" >= "budgets"."active_from"
        )
      ))
);
--> statement-breakpoint
ALTER TABLE "application_commands" DROP CONSTRAINT "application_commands_operation_allowlist_check";--> statement-breakpoint
-- Composite foreign keys must find their referenced unique keys before they
-- are added. These keys are also the tenant-safe join anchors for children.
CREATE UNIQUE INDEX "account_entries_id_household_id_uq" ON "account_entries" USING btree ("id","household_id");--> statement-breakpoint
CREATE UNIQUE INDEX "budgets_id_household_id_uq" ON "budgets" USING btree ("id","household_id");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_movements_id_household_id_uq" ON "budget_movements" USING btree ("id","household_id");--> statement-breakpoint
ALTER TABLE "budget_allocation_rules" ADD CONSTRAINT "budget_allocation_rules_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_allocation_rules" ADD CONSTRAINT "budget_allocation_rules_budget_household_fkey" FOREIGN KEY ("budget_id","household_id") REFERENCES "public"."budgets"("id","household_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_movements" ADD CONSTRAINT "budget_movements_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_movements" ADD CONSTRAINT "budget_movements_budget_household_fkey" FOREIGN KEY ("budget_id","household_id") REFERENCES "public"."budgets"("id","household_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_movements" ADD CONSTRAINT "budget_movements_financial_event_household_fkey" FOREIGN KEY ("financial_event_id","household_id") REFERENCES "public"."financial_events"("id","household_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_movements" ADD CONSTRAINT "budget_movements_account_entry_household_fkey" FOREIGN KEY ("account_entry_id","household_id") REFERENCES "public"."account_entries"("id","household_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_movements" ADD CONSTRAINT "budget_movements_correction_household_fkey" FOREIGN KEY ("corrects_movement_id","household_id") REFERENCES "public"."budget_movements"("id","household_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_category_household_fkey" FOREIGN KEY ("category_id","household_id") REFERENCES "public"."categories"("id","household_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "budget_allocation_rules_id_household_id_uq" ON "budget_allocation_rules" USING btree ("id","household_id");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_allocation_rules_budget_effective_from_uq" ON "budget_allocation_rules" USING btree ("budget_id","effective_from");--> statement-breakpoint
CREATE INDEX "budget_allocation_rules_household_budget_effective_from_idx" ON "budget_allocation_rules" USING btree ("household_id","budget_id","effective_from");--> statement-breakpoint
CREATE INDEX "budget_allocation_rules_household_effective_from_idx" ON "budget_allocation_rules" USING btree ("household_id","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_movements_household_reference_id_uq" ON "budget_movements" USING btree ("household_id","reference_id");--> statement-breakpoint
CREATE INDEX "budget_movements_household_budget_effective_on_id_idx" ON "budget_movements" USING btree ("household_id","budget_id","effective_on","id");--> statement-breakpoint
CREATE INDEX "budget_movements_household_effective_on_budget_idx" ON "budget_movements" USING btree ("household_id","effective_on","budget_id");--> statement-breakpoint
CREATE INDEX "budget_movements_household_source_reference_idx" ON "budget_movements" USING btree ("household_id","source_reference_id");--> statement-breakpoint
CREATE UNIQUE INDEX "budgets_household_reference_id_uq" ON "budgets" USING btree ("household_id","reference_id");--> statement-breakpoint
CREATE INDEX "budgets_household_status_active_from_idx" ON "budgets" USING btree ("household_id","status","active_from");--> statement-breakpoint
CREATE INDEX "budgets_household_category_active_from_idx" ON "budgets" USING btree ("household_id","category_id","active_from");--> statement-breakpoint
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
        'planned_event.cancel',
        'budget.create',
        'budget.update',
        'budget.close',
        'budget.movement.contribution',
        'budget.movement.withdrawal',
        'budget.movement.transfer',
        'budget.movement.correct',
        'budget.allocation.replace',
        'budget.distribution'
      ));--> statement-breakpoint
-- btree_gist provides UUID equality operator classes for the temporal
-- exclusion constraints below. IF NOT EXISTS keeps this forward migration
-- safe on databases that already installed it for S06.
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
ALTER TABLE "budgets"
  ADD CONSTRAINT "budgets_category_active_window_no_overlap_excl"
  EXCLUDE USING gist (
    "household_id" WITH =,
    "category_id" WITH =,
    (daterange(
      "active_from",
      coalesce("closed_on", 'infinity'::date),
      '[)'
    )) WITH &&
  );--> statement-breakpoint
ALTER TABLE "budget_allocation_rules"
  ADD CONSTRAINT "budget_allocation_rules_budget_window_no_overlap_excl"
  EXCLUDE USING gist (
    "household_id" WITH =,
    "budget_id" WITH =,
    (daterange(
      "effective_from",
      coalesce("effective_until", 'infinity'::date),
      '[)'
    )) WITH &&
  );--> statement-breakpoint
CREATE UNIQUE INDEX "budget_movements_household_source_reference_uq"
  ON "budget_movements" USING btree ("household_id", "source_reference_id")
  WHERE "source_reference_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "budget_movements_household_account_entry_uq"
  ON "budget_movements" USING btree ("household_id", "account_entry_id")
  WHERE "account_entry_id" is not null;--> statement-breakpoint
CREATE FUNCTION "public"."budgets_category_integrity_check_fn"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  category_kind_value "public"."category_kind";
  category_status_value "public"."account_status";
BEGIN
  SELECT category."kind", category."status"
    INTO category_kind_value, category_status_value
    FROM "public"."categories" category
   WHERE category."id" = NEW."category_id"
     AND category."household_id" = NEW."household_id";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'budgets.category_id has no matching household category'
      USING ERRCODE = '23503';
  END IF;

  IF category_kind_value <> 'EXPENSE'::"public"."category_kind" THEN
    RAISE EXCEPTION 'budgets.category_id must reference an EXPENSE category'
      USING ERRCODE = '23514';
  END IF;

  IF category_status_value <> 'ACTIVE'::"public"."account_status" THEN
    RAISE EXCEPTION 'budgets.category_id cannot attach a new budget to an archived category'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "budgets_category_integrity_check"
BEFORE INSERT OR UPDATE OF "category_id", "household_id"
ON "public"."budgets"
FOR EACH ROW
EXECUTE FUNCTION "public"."budgets_category_integrity_check_fn"();--> statement-breakpoint
CREATE FUNCTION "public"."budgets_lifecycle_guard_fn"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."status" = 'CLOSED'::"public"."budget_status"
     AND NEW."status" <> 'CLOSED'::"public"."budget_status" THEN
    RAISE EXCEPTION 'a closed budget cannot be reopened'
      USING ERRCODE = '23514';
  END IF;

  IF OLD."status" = 'CLOSED'::"public"."budget_status"
     AND NEW."closed_on" IS DISTINCT FROM OLD."closed_on" THEN
    RAISE EXCEPTION 'a closed budget closing date is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF (
    NEW."category_id" IS DISTINCT FROM OLD."category_id"
    OR NEW."active_from" IS DISTINCT FROM OLD."active_from"
  )
  AND EXISTS (
    SELECT 1
      FROM "public"."budget_movements" movement
     WHERE movement."budget_id" = OLD."id"
       AND movement."household_id" = OLD."household_id"
  ) THEN
    RAISE EXCEPTION 'budget category and active_from are immutable after a movement exists'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "budgets_lifecycle_guard"
BEFORE UPDATE OF "status", "closed_on", "category_id", "active_from"
ON "public"."budgets"
FOR EACH ROW
EXECUTE FUNCTION "public"."budgets_lifecycle_guard_fn"();--> statement-breakpoint
CREATE FUNCTION "public"."budget_allocation_rule_integrity_check_fn"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  budget_active_from date;
  budget_closed_on date;
BEGIN
  SELECT budget."active_from", budget."closed_on"
    INTO budget_active_from, budget_closed_on
    FROM "public"."budgets" budget
   WHERE budget."id" = NEW."budget_id"
     AND budget."household_id" = NEW."household_id";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'budget_allocation_rules.budget_id has no matching household budget'
      USING ERRCODE = '23503';
  END IF;

  IF NEW."effective_from" < budget_active_from THEN
    RAISE EXCEPTION 'allocation rule cannot begin before its budget'
      USING ERRCODE = '23514';
  END IF;

  IF budget_closed_on IS NOT NULL
     AND (
       NEW."effective_from" >= budget_closed_on
       OR NEW."effective_until" IS NULL
       OR NEW."effective_until" > budget_closed_on
     ) THEN
    RAISE EXCEPTION 'allocation rule must stay inside a closed budget window'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "budget_allocation_rule_integrity_check"
BEFORE INSERT OR UPDATE OF "budget_id", "household_id", "effective_from", "effective_until"
ON "public"."budget_allocation_rules"
FOR EACH ROW
EXECUTE FUNCTION "public"."budget_allocation_rule_integrity_check_fn"();--> statement-breakpoint
CREATE FUNCTION "public"."budget_movement_integrity_check_fn"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  budget_active_from date;
  budget_closed_on date;
  corrected_budget_id uuid;
  event_kind_value "public"."financial_event_kind";
  event_status_value "public"."financial_event_status";
  entry_event_id uuid;
  entry_status_value "public"."account_entry_status";
  entry_posted_on date;
BEGIN
  SELECT budget."active_from", budget."closed_on"
    INTO budget_active_from, budget_closed_on
    FROM "public"."budgets" budget
   WHERE budget."id" = NEW."budget_id"
     AND budget."household_id" = NEW."household_id";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'budget_movements.budget_id has no matching household budget'
      USING ERRCODE = '23503';
  END IF;

  IF NEW."effective_on" < budget_active_from
     OR (
       budget_closed_on IS NOT NULL
       AND NEW."effective_on" > budget_closed_on
     ) THEN
    RAISE EXCEPTION 'budget movement is outside the budget effective window'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."corrects_movement_id" IS NOT NULL THEN
    SELECT movement."budget_id"
      INTO corrected_budget_id
      FROM "public"."budget_movements" movement
     WHERE movement."id" = NEW."corrects_movement_id"
       AND movement."household_id" = NEW."household_id";

    IF NOT FOUND THEN
      RAISE EXCEPTION 'budget movement correction has no matching household movement'
        USING ERRCODE = '23503';
    END IF;

    IF corrected_budget_id <> NEW."budget_id" THEN
      RAISE EXCEPTION 'budget movement correction must stay in the same budget'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW."source_kind" = 'CORRECTION'::"public"."budget_movement_source_kind"
     AND NEW."corrects_movement_id" IS NULL THEN
    RAISE EXCEPTION 'a correction movement must identify the movement it corrects'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."source_kind" = 'TRANSFER'::"public"."budget_movement_source_kind"
     AND NEW."transfer_reference_id" IS NULL THEN
    RAISE EXCEPTION 'a transfer movement must identify its transfer reference'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."financial_event_id" IS NOT NULL THEN
    SELECT event."kind", event."status"
      INTO event_kind_value, event_status_value
      FROM "public"."financial_events" event
     WHERE event."id" = NEW."financial_event_id"
       AND event."household_id" = NEW."household_id";

    IF NOT FOUND THEN
      RAISE EXCEPTION 'budget movement source event has no matching household event'
        USING ERRCODE = '23503';
    END IF;

    IF NEW."source_kind" = 'ALLOCATION'::"public"."budget_movement_source_kind"
       AND (
         event_kind_value <> 'INCOME'::"public"."financial_event_kind"
         OR event_status_value <> 'POSTED'::"public"."financial_event_status"
         OR NEW."kind" <> 'CONTRIBUTION'::"public"."budget_movement_kind"
       ) THEN
      RAISE EXCEPTION 'allocation movement must source a posted income contribution'
        USING ERRCODE = '23514';
    END IF;

    IF NEW."source_kind" = 'EXPENSE'::"public"."budget_movement_source_kind"
       AND (
         event_kind_value NOT IN (
           'EXPENSE'::"public"."financial_event_kind",
           'PURCHASE'::"public"."financial_event_kind"
         )
         OR event_status_value <> 'POSTED'::"public"."financial_event_status"
         OR NEW."kind" <> 'WITHDRAWAL'::"public"."budget_movement_kind"
       ) THEN
      RAISE EXCEPTION 'expense movement must source a posted expense or purchase withdrawal'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW."account_entry_id" IS NOT NULL THEN
    SELECT entry."financial_event_id", entry."status", entry."posted_on"
      INTO entry_event_id, entry_status_value, entry_posted_on
      FROM "public"."account_entries" entry
     WHERE entry."id" = NEW."account_entry_id"
       AND entry."household_id" = NEW."household_id";

    IF NOT FOUND THEN
      RAISE EXCEPTION 'budget movement source entry has no matching household entry'
        USING ERRCODE = '23503';
    END IF;

    IF entry_status_value <> 'POSTED'::"public"."account_entry_status"
       OR entry_posted_on IS NULL THEN
      RAISE EXCEPTION 'budget movement source entry must be posted'
        USING ERRCODE = '23514';
    END IF;

    IF NEW."financial_event_id" IS NOT NULL
       AND NEW."financial_event_id" <> entry_event_id THEN
      RAISE EXCEPTION 'budget movement event and entry sources must match'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "budget_movement_integrity_check"
BEFORE INSERT OR UPDATE OF
  "budget_id", "household_id", "effective_on", "source_kind",
  "source_reference_id", "financial_event_id", "account_entry_id",
  "corrects_movement_id", "transfer_reference_id", "kind"
ON "public"."budget_movements"
FOR EACH ROW
EXECUTE FUNCTION "public"."budget_movement_integrity_check_fn"();--> statement-breakpoint
CREATE FUNCTION "public"."budget_movements_append_only_guard_fn"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'budget movements are append-only and cannot be updated or deleted'
    USING ERRCODE = '23514';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "budget_movements_append_only_guard"
BEFORE UPDATE OR DELETE
ON "public"."budget_movements"
FOR EACH ROW
EXECUTE FUNCTION "public"."budget_movements_append_only_guard_fn"();
