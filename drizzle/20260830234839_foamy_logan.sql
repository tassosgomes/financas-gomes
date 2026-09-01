ALTER TYPE "public"."account_entry_status" ADD VALUE 'EXPECTED' BEFORE 'POSTED';--> statement-breakpoint
ALTER TYPE "public"."financial_event_kind" ADD VALUE 'PURCHASE';--> statement-breakpoint
ALTER TYPE "public"."financial_event_kind" ADD VALUE 'TRANSFER';--> statement-breakpoint
ALTER TYPE "public"."financial_event_status" ADD VALUE 'PLANNED' BEFORE 'POSTED';--> statement-breakpoint
ALTER TYPE "public"."financial_event_status" ADD VALUE 'EXPECTED' BEFORE 'POSTED';--> statement-breakpoint
ALTER TYPE "public"."financial_event_status" ADD VALUE 'PENDING' BEFORE 'POSTED';--> statement-breakpoint
ALTER TABLE "account_entries" DROP CONSTRAINT "account_entries_posted_shape_check";--> statement-breakpoint
ALTER TABLE "account_entries" ADD COLUMN "installment_id" uuid;--> statement-breakpoint
ALTER TABLE "account_entries" ADD CONSTRAINT "account_entries_installment_household_fkey" FOREIGN KEY ("installment_id","household_id") REFERENCES "public"."installments"("id","household_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_entries_installment_id_uq" ON "account_entries" USING btree ("installment_id") WHERE "account_entries"."installment_id" is not null;--> statement-breakpoint
ALTER TABLE "account_entries" ADD CONSTRAINT "account_entries_status_shape_check" CHECK ((
        "account_entries"."status"::text = 'POSTED'
        and "account_entries"."posted_on" is not null
        and "account_entries"."expected_on" is null
      )
      or (
        "account_entries"."status"::text = 'EXPECTED'
        and "account_entries"."expected_on" is not null
        and "account_entries"."posted_on" is null
      ));--> statement-breakpoint
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
        'credit_card.billing_rule.update',
        'credit_card.purchase.create',
        'credit_card.purchase.update_metadata',
        'credit_card.purchase.cancel',
        'credit_card.payment.create'
      ));
--> statement-breakpoint
-- A CHECK constraint cannot inspect the referenced account row. This trigger
-- keeps the S06 configuration restricted to accounts of type CREDIT_CARD.
CREATE FUNCTION "public"."credit_cards_account_type_check_fn"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM "public"."accounts"
     WHERE "id" = NEW."account_id"
       AND "household_id" = NEW."household_id"
       AND "type" = 'CREDIT_CARD'
  ) THEN
    RAISE EXCEPTION 'credit_cards.account_id must reference a CREDIT_CARD account'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "credit_cards_account_type_check"
BEFORE INSERT OR UPDATE OF "account_id", "household_id"
ON "public"."credit_cards"
FOR EACH ROW
EXECUTE FUNCTION "public"."credit_cards_account_type_check_fn"();
