CREATE TABLE "spendable_settings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"effective_from" date NOT NULL,
	"operational_buffer_cents" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "spendable_settings_operational_buffer_nonnegative_check" CHECK ("spendable_settings"."operational_buffer_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "spendable_settings" ADD CONSTRAINT "spendable_settings_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "spendable_settings_id_household_id_uq" ON "spendable_settings" USING btree ("id","household_id");--> statement-breakpoint
CREATE UNIQUE INDEX "spendable_settings_household_effective_from_uq" ON "spendable_settings" USING btree ("household_id","effective_from");--> statement-breakpoint
CREATE INDEX "spendable_settings_household_effective_from_idx" ON "spendable_settings" USING btree ("household_id","effective_from");