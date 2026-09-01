CREATE TYPE "public"."installment_status" AS ENUM('PLANNED', 'POSTED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "credit_card_billing_rules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"card_id" uuid NOT NULL,
	"closing_day" integer NOT NULL,
	"due_day" integer NOT NULL,
	"effective_from" date NOT NULL,
	"effective_until" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_card_billing_rules_closing_day_check" CHECK ("credit_card_billing_rules"."closing_day" between 1 and 31),
	CONSTRAINT "credit_card_billing_rules_due_day_check" CHECK ("credit_card_billing_rules"."due_day" between 1 and 31),
	CONSTRAINT "credit_card_billing_rules_effective_interval_check" CHECK ("credit_card_billing_rules"."effective_until" is null
        or "credit_card_billing_rules"."effective_until" > "credit_card_billing_rules"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "credit_card_purchases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"card_id" uuid NOT NULL,
	"financial_event_id" uuid NOT NULL,
	"installment_plan_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_cards" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"credit_limit_cents" bigint NOT NULL,
	"default_payment_account_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_cards_credit_limit_positive_check" CHECK ("credit_cards"."credit_limit_cents" > 0),
	CONSTRAINT "credit_cards_default_payment_account_distinct_check" CHECK ("credit_cards"."default_payment_account_id" is null
        or "credit_cards"."default_payment_account_id" <> "credit_cards"."account_id")
);
--> statement-breakpoint
CREATE TABLE "installment_plans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"purchase_id" uuid NOT NULL,
	"total_amount_cents" bigint NOT NULL,
	"installment_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "installment_plans_total_amount_positive_check" CHECK ("installment_plans"."total_amount_cents" > 0),
	CONSTRAINT "installment_plans_count_check" CHECK ("installment_plans"."installment_count" between 1 and 120)
);
--> statement-breakpoint
CREATE TABLE "installments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"purchase_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"amount_cents" bigint NOT NULL,
	"status" "installment_status" DEFAULT 'PLANNED' NOT NULL,
	"billing_rule_id" uuid NOT NULL,
	"billing_cycle" date NOT NULL,
	"billing_closing_day" integer NOT NULL,
	"billing_due_day" integer NOT NULL,
	"billing_closing_on" date NOT NULL,
	"billing_due_on" date NOT NULL,
	"billing_due_on_override" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "installments_sequence_check" CHECK ("installments"."sequence" between 1 and 120),
	CONSTRAINT "installments_amount_positive_check" CHECK ("installments"."amount_cents" > 0),
	CONSTRAINT "installments_billing_days_check" CHECK ("installments"."billing_closing_day" between 1 and 31
        and "installments"."billing_due_day" between 1 and 31),
	CONSTRAINT "installments_billing_dates_check" CHECK ("installments"."billing_due_on" > "installments"."billing_closing_on"
        and "installments"."billing_due_on_override" is null
          or "installments"."billing_due_on_override" > "installments"."billing_closing_on"),
	CONSTRAINT "installments_billing_cycle_first_day_check" CHECK ("installments"."billing_cycle" = date_trunc('month', "installments"."billing_cycle")::date)
);
--> statement-breakpoint
-- Composite referenced keys must exist before PostgreSQL adds the tenant-safe
-- foreign keys that target them.
CREATE UNIQUE INDEX "credit_card_billing_rules_id_household_id_uq" ON "credit_card_billing_rules" USING btree ("id","household_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_card_purchases_id_household_id_uq" ON "credit_card_purchases" USING btree ("id","household_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_cards_id_household_id_uq" ON "credit_cards" USING btree ("id","household_id");--> statement-breakpoint
CREATE UNIQUE INDEX "installment_plans_id_household_id_uq" ON "installment_plans" USING btree ("id","household_id");--> statement-breakpoint
ALTER TABLE "credit_card_billing_rules" ADD CONSTRAINT "credit_card_billing_rules_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_card_billing_rules" ADD CONSTRAINT "credit_card_billing_rules_card_household_fkey" FOREIGN KEY ("card_id","household_id") REFERENCES "public"."credit_cards"("id","household_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_card_purchases" ADD CONSTRAINT "credit_card_purchases_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_card_purchases" ADD CONSTRAINT "credit_card_purchases_card_household_fkey" FOREIGN KEY ("card_id","household_id") REFERENCES "public"."credit_cards"("id","household_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_card_purchases" ADD CONSTRAINT "credit_card_purchases_event_household_fkey" FOREIGN KEY ("financial_event_id","household_id") REFERENCES "public"."financial_events"("id","household_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_cards" ADD CONSTRAINT "credit_cards_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_cards" ADD CONSTRAINT "credit_cards_account_household_fkey" FOREIGN KEY ("account_id","household_id") REFERENCES "public"."accounts"("id","household_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_cards" ADD CONSTRAINT "credit_cards_default_payment_account_household_fkey" FOREIGN KEY ("default_payment_account_id","household_id") REFERENCES "public"."accounts"("id","household_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installment_plans" ADD CONSTRAINT "installment_plans_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installment_plans" ADD CONSTRAINT "installment_plans_purchase_household_fkey" FOREIGN KEY ("purchase_id","household_id") REFERENCES "public"."credit_card_purchases"("id","household_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installments" ADD CONSTRAINT "installments_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installments" ADD CONSTRAINT "installments_plan_household_fkey" FOREIGN KEY ("plan_id","household_id") REFERENCES "public"."installment_plans"("id","household_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installments" ADD CONSTRAINT "installments_purchase_household_fkey" FOREIGN KEY ("purchase_id","household_id") REFERENCES "public"."credit_card_purchases"("id","household_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installments" ADD CONSTRAINT "installments_billing_rule_household_fkey" FOREIGN KEY ("billing_rule_id","household_id") REFERENCES "public"."credit_card_billing_rules"("id","household_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "credit_card_billing_rules_card_effective_from_uq" ON "credit_card_billing_rules" USING btree ("household_id","card_id","effective_from");--> statement-breakpoint
CREATE INDEX "credit_card_billing_rules_household_card_effective_idx" ON "credit_card_billing_rules" USING btree ("household_id","card_id","effective_from","effective_until");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_card_purchases_event_id_uq" ON "credit_card_purchases" USING btree ("financial_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_card_purchases_installment_plan_id_uq" ON "credit_card_purchases" USING btree ("installment_plan_id");--> statement-breakpoint
CREATE INDEX "credit_card_purchases_household_card_created_idx" ON "credit_card_purchases" USING btree ("household_id","card_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_cards_account_id_uq" ON "credit_cards" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "credit_cards_household_account_idx" ON "credit_cards" USING btree ("household_id","account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "installment_plans_purchase_id_uq" ON "installment_plans" USING btree ("purchase_id");--> statement-breakpoint
CREATE INDEX "installment_plans_household_purchase_idx" ON "installment_plans" USING btree ("household_id","purchase_id");--> statement-breakpoint
CREATE UNIQUE INDEX "installments_id_household_id_uq" ON "installments" USING btree ("id","household_id");--> statement-breakpoint
CREATE UNIQUE INDEX "installments_plan_sequence_uq" ON "installments" USING btree ("plan_id","sequence");--> statement-breakpoint
CREATE INDEX "installments_household_cycle_due_idx" ON "installments" USING btree ("household_id","billing_cycle","billing_due_on");--> statement-breakpoint
CREATE INDEX "installments_household_status_due_idx" ON "installments" USING btree ("household_id","status","billing_due_on");--> statement-breakpoint
CREATE INDEX "installments_household_purchase_sequence_idx" ON "installments" USING btree ("household_id","purchase_id","sequence");
