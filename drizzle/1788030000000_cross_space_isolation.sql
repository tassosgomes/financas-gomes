-- T08: generic protected resource used to prove tenant-scoped reads/writes.
-- The resource is intentionally not a financial ledger aggregate.
CREATE TABLE "protected_resources" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "protected_resources"
	ADD CONSTRAINT "protected_resources_household_id_fkey"
	FOREIGN KEY ("household_id") REFERENCES "public"."households"("id")
	ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "protected_resources"
	ADD CONSTRAINT "protected_resources_created_by_fkey"
	FOREIGN KEY ("created_by") REFERENCES "public"."user"("id")
	ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "protected_resources"
	ADD CONSTRAINT "protected_resources_creator_member_fkey"
	FOREIGN KEY ("household_id", "created_by")
	REFERENCES "public"."household_members"("household_id", "user_id")
	ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "protected_resources_id_household_id_uq"
	ON "protected_resources" USING btree ("id", "household_id");
--> statement-breakpoint
CREATE INDEX "protected_resources_household_id_idx"
	ON "protected_resources" USING btree ("household_id");
--> statement-breakpoint
CREATE INDEX "protected_resources_household_id_created_at_idx"
	ON "protected_resources" USING btree ("household_id", "created_at");
