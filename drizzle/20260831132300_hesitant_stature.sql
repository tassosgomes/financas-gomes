ALTER TABLE "application_commands" DROP CONSTRAINT "application_commands_operation_allowlist_check";--> statement-breakpoint
ALTER TABLE "installments" DROP CONSTRAINT "installments_billing_dates_check";--> statement-breakpoint
CREATE UNIQUE INDEX "installment_plans_id_purchase_household_uq" ON "installment_plans" USING btree ("id","purchase_id","household_id");--> statement-breakpoint
-- The purchase and plan form one aggregate and point at each other.  The
-- reverse edge is deferred so the writer can insert purchase then plan in one
-- transaction while PostgreSQL still validates both rows before commit.
ALTER TABLE "credit_card_purchases" ADD CONSTRAINT "credit_card_purchases_installment_plan_household_fkey" FOREIGN KEY ("installment_plan_id","household_id") REFERENCES "public"."installment_plans"("id","household_id") ON DELETE restrict ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "installments" ADD CONSTRAINT "installments_plan_purchase_household_fkey" FOREIGN KEY ("plan_id","purchase_id","household_id") REFERENCES "public"."installment_plans"("id","purchase_id","household_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
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
        'credit_card.payment.create'
      ));--> statement-breakpoint
ALTER TABLE "installments" ADD CONSTRAINT "installments_billing_dates_check" CHECK ("installments"."billing_due_on" > "installments"."billing_closing_on"
        and (
          "installments"."billing_due_on_override" is null
          or "installments"."billing_due_on_override" > "installments"."billing_closing_on"
        ));
--> statement-breakpoint
-- A purchase must point at a PURCHASE fact.  This cross-table invariant is
-- kept in a trigger because PostgreSQL CHECK constraints cannot query a
-- referenced row.
CREATE FUNCTION "public"."credit_card_purchase_event_shape_check_fn"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM "public"."financial_events"
     WHERE "id" = NEW."financial_event_id"
       AND "household_id" = NEW."household_id"
       AND "kind" = 'PURCHASE'
  ) THEN
    RAISE EXCEPTION 'credit_card_purchases.financial_event_id must reference a PURCHASE event'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "credit_card_purchase_event_shape_check"
BEFORE INSERT OR UPDATE OF "financial_event_id", "household_id"
ON "public"."credit_card_purchases"
FOR EACH ROW
EXECUTE FUNCTION "public"."credit_card_purchase_event_shape_check_fn"();
--> statement-breakpoint
-- Prevent an existing purchase from being silently reclassified as another
-- kind of financial event after the aggregate has been materialized.
CREATE FUNCTION "public"."financial_event_purchase_kind_guard_fn"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."kind" <> 'PURCHASE'
     AND EXISTS (
       SELECT 1
         FROM "public"."credit_card_purchases"
        WHERE "financial_event_id" = NEW."id"
          AND "household_id" = NEW."household_id"
     ) THEN
    RAISE EXCEPTION 'financial_events.kind for a credit-card purchase is immutable'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "financial_event_purchase_kind_guard"
BEFORE UPDATE OF "kind", "household_id"
ON "public"."financial_events"
FOR EACH ROW
EXECUTE FUNCTION "public"."financial_event_purchase_kind_guard_fn"();
--> statement-breakpoint
-- The plan total is a denormalized integrity mirror of its single economic
-- event.  The writer still inserts all schedule rows atomically; this trigger
-- prevents a plan from being created with a different economic amount.
CREATE FUNCTION "public"."installment_plan_event_amount_check_fn"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  event_amount bigint;
BEGIN
  SELECT fe."amount_cents"
    INTO event_amount
    FROM "public"."credit_card_purchases" purchase
    JOIN "public"."financial_events" fe
      ON fe."id" = purchase."financial_event_id"
     AND fe."household_id" = purchase."household_id"
   WHERE purchase."id" = NEW."purchase_id"
     AND purchase."household_id" = NEW."household_id"
     AND fe."kind" = 'PURCHASE';

  IF event_amount IS NULL OR NEW."total_amount_cents" <> event_amount THEN
    RAISE EXCEPTION 'installment_plans.total_amount_cents must match the PURCHASE event amount'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "installment_plan_event_amount_check"
BEFORE INSERT OR UPDATE OF "purchase_id", "household_id", "total_amount_cents"
ON "public"."installment_plans"
FOR EACH ROW
EXECUTE FUNCTION "public"."installment_plan_event_amount_check_fn"();
--> statement-breakpoint
-- Keep an account specialized as CREDIT_CARD while its configuration exists.
-- The trigger on credit_cards covers inserts/updates in that direction; this
-- companion guard covers an account type update in the other direction.
CREATE FUNCTION "public"."accounts_credit_card_type_guard_fn"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."type" <> 'CREDIT_CARD'
     AND EXISTS (
       SELECT 1
         FROM "public"."credit_cards"
        WHERE "account_id" = NEW."id"
          AND "household_id" = NEW."household_id"
     ) THEN
    RAISE EXCEPTION 'accounts.type cannot leave CREDIT_CARD while a card configuration exists'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "accounts_credit_card_type_guard"
BEFORE UPDATE OF "type", "household_id"
ON "public"."accounts"
FOR EACH ROW
EXECUTE FUNCTION "public"."accounts_credit_card_type_guard_fn"();
